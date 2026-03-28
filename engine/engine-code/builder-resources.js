import fs from "node:fs";
import path from "node:path";
import { STATIC_ROOT } from "./paths.js";

const HTML_DIR = path.join(STATIC_ROOT, "html");
const JSON_SUBMISSION_DIR = path.join(STATIC_ROOT, "json", "submission");
const JSON_RESPONSE_SCHEMA_DIR = path.join(STATIC_ROOT, "json", "response-schema");

/** Config-relative path segments (always posix-style). */
const REL_HTML = "html";
const REL_JSON_SUBMISSION = "json/submission";
const REL_JSON_RESPONSE_SCHEMA = "json/response-schema";

const SAFE_BASE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

export function ensureBuilderDirs() {
  fs.mkdirSync(HTML_DIR, { recursive: true });
  fs.mkdirSync(JSON_SUBMISSION_DIR, { recursive: true });
  fs.mkdirSync(JSON_RESPONSE_SCHEMA_DIR, { recursive: true });
}

/**
 * @param {string} input
 * @param {'.html' | '.json'} ext
 */
export function sanitizeBaseName(input, ext) {
  let s = String(input || "").trim();
  if (ext === ".html") s = s.replace(/\.html?$/i, "");
  if (ext === ".json") s = s.replace(/\.json$/i, "");
  if (!SAFE_BASE.test(s)) return { ok: false, error: "invalid name (use letters, numbers, _ or -; max 64 chars)" };
  return { ok: true, base: s };
}

function listHtmlRel() {
  if (!fs.existsSync(HTML_DIR)) return [];
  return fs
    .readdirSync(HTML_DIR)
    .filter((f) => f.endsWith(".html"))
    .map((f) => path.posix.join(REL_HTML, f))
    .sort();
}

function listJsonRel(absDir, relPrefix) {
  if (!fs.existsSync(absDir)) return [];
  return fs
    .readdirSync(absDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.posix.join(relPrefix, f))
    .sort();
}

export function listBuilderResources() {
  return {
    html: listHtmlRel(),
    submission: listJsonRel(JSON_SUBMISSION_DIR, REL_JSON_SUBMISSION),
    responseSchema: listJsonRel(JSON_RESPONSE_SCHEMA_DIR, REL_JSON_RESPONSE_SCHEMA),
  };
}

function htmlBoilerplate(titleSafe) {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${titleSafe}</title>
    <link rel="stylesheet" href="/css/global.css" />
  </head>
  <body>
    <main>
      <h1>${titleSafe}</h1>
      <p>New page scaffold. Edit under <code>project/project-code/html/</code>.</p>
    </main>
  </body>
</html>
`;
}

/**
 * @param {string} baseName raw user/chosen stem without path
 */
export function createHtmlPage(baseName) {
  const s = sanitizeBaseName(baseName, ".html");
  if (!s.ok) return { ok: false, error: s.error };
  ensureBuilderDirs();
  const file = path.join(HTML_DIR, `${s.base}.html`);
  if (fs.existsSync(file)) return { ok: false, error: "page already exists" };
  fs.writeFileSync(file, htmlBoilerplate(s.base), "utf8");
  return { ok: true, path: path.posix.join(REL_HTML, `${s.base}.html`) };
}

/**
 * @param {'submission' | 'response-schema'} kind
 * @param {string} baseName
 */
export function createJsonDataFile(kind, baseName) {
  let dir;
  let relPrefix;
  if (kind === "submission") {
    dir = JSON_SUBMISSION_DIR;
    relPrefix = REL_JSON_SUBMISSION;
  } else if (kind === "response-schema") {
    dir = JSON_RESPONSE_SCHEMA_DIR;
    relPrefix = REL_JSON_RESPONSE_SCHEMA;
  } else {
    return { ok: false, error: "invalid kind" };
  }
  const s = sanitizeBaseName(baseName, ".json");
  if (!s.ok) return { ok: false, error: s.error };
  ensureBuilderDirs();
  const file = path.join(dir, `${s.base}.json`);
  if (fs.existsSync(file)) return { ok: false, error: "file already exists" };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, "{}\n", "utf8");
  return { ok: true, path: path.posix.join(relPrefix, `${s.base}.json`) };
}
