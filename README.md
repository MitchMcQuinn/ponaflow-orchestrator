# ponaflow-orchestrator

**ponaflow** is a small **web client + API orchestration** stack for multi-step flows: static HTML served from the repo, a JSON project config, and a Node HTTP server that **proxies** API calls to your real webhook so the browser never sees the webhook URL.

This repository is a **template-oriented** layout: one logical **project** per repo, validator + dev server + client runtime + optional builder UI.

For product behavior (pages, action elements, `key` insertion, submission/response packages, URL overrides), see [docs/ponaflow-overview.md](docs/ponaflow-overview.md). This README focuses on **how this codebase implements** that behavior.

---

## Requirements

- **Node.js 18+** (ES modules, `fetch`, `node:test`).
- **No npm dependencies**; everything uses Node builtins.

---

## Quick start

```bash
npm run validate   # validates project/config/config.json before you run
npm start          # HTTP server (default port 3847; see Port binding below)
```

Open the app in a browser:

- **Landing / home:** `http://localhost:3847/` or `http://localhost:3847/home` (depends on your slugs; `/` serves the page whose `page_html` matches `landing_page`).
- **Config builder (local):** `http://localhost:3847/build`

---

## Repository layout

| Path | Role |
|------|------|
| [project/config/config.json](project/config/config.json) | Single source of truth for the **project** (pages, actions, webhook URL). Validated on server startup. |
| [project/project-code/](project/project-code/) | **Static site root** (HTML, CSS, JSON packages/schemas under `html/`, `json/submission/`, `json/response-schema/`, etc.). |
| [engine/engine-code/server.js](engine/engine-code/server.js) | HTTP server: routing, HTML injection, APIs, webhook proxy, builder file APIs. |
| [engine/engine-code/builder-resources.js](engine/engine-code/builder-resources.js) | Lists/creates HTML + JSON data files for the builder (under `project-code`). |
| [engine/engine-code/config-validator.js](engine/engine-code/config-validator.js) | Shared validation for CLI, server boot, and `/api/validate`. |
| [engine/engine-code/paths.js](engine/engine-code/paths.js) | `REPO_ROOT`, `PROJECT_DIR`, `STATIC_ROOT`, path helpers. |
| [engine/engine-code/runtime/ponaflow-runtime.js](engine/engine-code/runtime/ponaflow-runtime.js) | Browser runtime: page load POST, action elements, `key` binding, schema checks. |
| [engine/engine-code/builder/index.html](engine/engine-code/builder/index.html) | Builder UI: dropdowns for HTML/JSON assets, **+ New** creates scaffold HTML (`{}`-seeded JSON). |
| [engine/engine-code/cli/validate.js](engine/engine-code/cli/validate.js) | CLI entry for `npm run validate`. |
| [engine/engine-code/engine.js](engine/engine-code/engine.js) | Re-exports for programmatic use. |
| [tests/](tests/) | `node --test` suites (validator tests today). |
| [docs/ponaflow-overview.md](docs/ponaflow-overview.md) | Human-facing spec for flows and attributes. |

---

## Path rules (critical for agents)

1. **`page_html`, `landing_page`, file-style `destination`**  
   Relative to **`project/project-code/`** (the static root).  
   Example: `html/landing.html` → `project/project-code/html/landing.html`.

2. **`submission_package`, `response_schema`**  
   Also relative to **`project/project-code/`**.  
   Convention: **`json/submission/*.json`** and **`json/response-schema/*.json`**.  
   Example: `json/submission/step1.json` → `project/project-code/json/submission/step1.json`.

3. **Runtime fetch for packages/schemas**  
   Same-origin static URLs: **`GET /<path>`** (path URL-encoded per segment), served from `project/project-code`.

4. **`GET /__ponaflow/…`** (optional)  
   Still serves files under **`project/`** for legacy paths; new configs should use static paths under (2).

5. **`destination` as slug**  
   If `destination` starts with `/`, it must match an existing **page `slug`** (validator enforces this). Navigation is client-side to that path.

---

## Config shape (summary)

- **`project`** must be an array of **exactly one** object (one project per repo).
- That object must include: **`name`**, **`landing_page`**, **`webhook_url`**, **`page[]`**, **`action_element[]`**.
- **`landing_page`** must match **`page_html`** of at least one page.
- Each **page** has **`slug`**, **`page_html`**, optional **`submission_package`**, optional **`response_schema`**.
- Each **action_element** has **`id`**, **`destination`**, optional **`immediate`** (default **true**), optional **`submission_package`**, optional **`response_schema`**.  
  - **`immediate: false`** → batch the form on submit.  
  - **`immediate: true`** on a form → POST on each field **change** (per-field payload merged with package + URL params).

Response rules use **merged schemas** for actions: page-level + action-level schema, with **action keys overriding** page keys on conflict (per overview doc).

Full rules and error messages are implemented in [config-validator.js](engine/engine-code/config-validator.js).

---

## HTTP server behavior

### Startup

- Loads and validates [project/config/config.json](project/config/config.json).  
- **Exits with code 1** if invalid (fix errors, then retry).

### Port binding

- Default **3847**. Set **`PORT`** to force a port.
- If **`PORT` is unset** and the default is **EADDRINUSE**, the server **increments the port** and logs which port it bound to.
- If **`PORT` is set** and that port is in use, the process **exits** with a short message (pick another port).

### Routes (high level)

| Method | Path | Purpose |
|--------|------|--------|
| GET | `/api/config` | Sanitized project JSON (**no `webhook_url`** to the client). |
| POST | `/api/webhook` | Body forwarded as JSON **POST** to the configured `webhook_url`; response/status passed back. |
| POST | `/api/validate` | Body = full config object; returns `{ ok, errors[] }` like the validator. |
| GET | `/api/builder/resources` | `{ html[], submission[], responseSchema[] }` config-relative paths for dropdowns. |
| POST | `/api/builder/create-html` | `{ name }` base name → creates `html/<name>.html` scaffold (409-like errors as JSON). |
| POST | `/api/builder/create-json` | `{ kind: "submission" \| "response-schema", name }` → `{}` file under `json/...` |
| GET | `/__ponaflow/…` | Serves files under `project/` (legacy); prefer static JSON under `project-code`. |
| GET | `/ponaflow-runtime.js` | Client bundle. |
| GET | `/build` | Builder UI. |
| GET | `/` | Landing page HTML (same file as `landing_page`), runtime injected. |
| GET | other | Static files under `project/project-code`; else **slug-based** match to serve `page_html` with runtime injected on `.html` responses. |

HTML responses from the server get **`<script src="/ponaflow-runtime.js" defer></script>`** injected before `</body>` when possible.

---

## Client runtime (browser)

Loaded automatically on served HTML. It:

1. Fetches **`/api/config`**, resolves the current page from **`location.pathname`** (and `/` → landing page).
2. On **page load**, if a submission package exists: load JSON, **merge query string** (dot-path keys; page load only per spec), **POST `/api/webhook`**, validate with **`response_schema`**, apply **`[key]`** bindings, optionally block with an alert banner if **`required`** fields are missing.
3. Wires **`[action-element-id]`** on `form`, `button`, `a` to config entries; merges **URL query params** into action submissions after the package; navigates **`destination`** after a successful action validation when not blocked.

DOM **`key`** attribute: dot-path into the validated view; **`img` / `source`** set `src`; **`ol` / `ul`** treat array values as list items (see overview).

---

## Commands

```bash
npm start          # or node engine/engine-code/server.js
npm run dev        # same as start
npm run validate   # validate project/config/config.json
npm test           # node --test tests/
```

---

## Tests and validation

- **Validator tests:** [tests/config-validator.test.js](tests/config-validator.test.js).  
- Extend **`tests/`** for new behavior (project convention: diagnostics/tests live under `/tests`).

---

## Operational notes

- **Upstream webhook** must accept **JSON POST** and ideally return JSON the schemas expect; non-JSON responses are wrapped/normalized in the proxy path—see [server.js](engine/engine-code/server.js) `handleWebhook`.
- **CORS** is mostly irrelevant for the default setup because the browser talks **same-origin** to ponaflow and only the server calls the external webhook.
- **Secrets:** Keep production webhooks out of committed config if the repo is public, or inject `webhook_url` at deploy time—the architecture already hides it from **`GET /api/config`**.

---

## For future agents: where to change what

| Goal | Primary location |
|------|------------------|
| Stricter config / new fields | `config-validator.js`, [project/config/config.json](project/config/config.json), tests |
| Routing, APIs, proxy, static | `server.js` |
| Path resolution | `paths.js` |
| Browser behavior, `key`, actions | `runtime/ponaflow-runtime.js` |
| Builder UX + file listing/creation | `builder/index.html`, `builder-resources.js` |
| Conceptual / UX spec | `docs/ponaflow-overview.md` |

When adding features, run **`npm run validate`** and **`npm test`** before committing.
