(function () {
  "use strict";

  function getByPath(obj, pathStr) {
    if (obj == null || !pathStr) return undefined;
    const parts = pathStr.split(".");
    let cur = obj;
    for (const p of parts) {
      if (cur == null) return undefined;
      cur = cur[p];
    }
    return cur;
  }

  function setByPath(obj, pathStr, value) {
    const parts = pathStr.split(".");
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i];
      if (cur[p] == null || typeof cur[p] !== "object") cur[p] = {};
      cur = cur[p];
    }
    cur[parts[parts.length - 1]] = value;
  }

  function deepMerge(base, ext) {
    const b =
      base != null && typeof base === "object" && !Array.isArray(base) ? { ...base } : {};
    if (ext == null || typeof ext !== "object" || Array.isArray(ext)) return b;
    const out = { ...b };
    for (const k of Object.keys(ext)) {
      const v = ext[k];
      if (
        v != null &&
        typeof v === "object" &&
        !Array.isArray(v) &&
        typeof out[k] === "object" &&
        out[k] !== null &&
        !Array.isArray(out[k])
      ) {
        out[k] = deepMerge(out[k], v);
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  function coerceQueryValue(v) {
    if (v === "true") return true;
    if (v === "false") return false;
    if (v !== "" && /^-?\d+(\.\d+)?$/.test(v)) return Number(v);
    return v;
  }

  function searchParamsToNested(search) {
    const out = {};
    for (const [k, v] of search.entries()) {
      setByPath(out, k, coerceQueryValue(v));
    }
    return out;
  }

  /** JSON/submission paths in config are relative to project/project-code (same static origin). */
  function staticDataUrl(configRelative) {
    const p = String(configRelative || "").replace(/^\//, "");
    if (!p) return "";
    return "/" + p.split("/").map(encodeURIComponent).join("/");
  }

  function findPageForSlug(pathname, pages) {
    let best = null;
    let bestLen = -1;
    for (const p of pages) {
      const s = p.slug || "";
      if (pathname === s || pathname.startsWith(s + "/")) {
        if (s.length > bestLen) {
          bestLen = s.length;
          best = p;
        }
      }
    }
    return best;
  }

  function findPage(pathname, project) {
    const pages = project.page || [];
    if (pathname === "/" || pathname === "") {
      const lp = project.landing_page;
      const hit = pages.find((p) => p.page_html === lp);
      return hit || null;
    }
    return findPageForSlug(pathname, pages);
  }

  async function fetchJson(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error("fetch_failed " + url);
    return r.json();
  }

  async function postWebhook(body) {
    const r = await fetch("/api/webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    let data = null;
    try {
      data = await r.json();
    } catch {
      data = {};
    }
    return { ok: r.ok, status: r.status, data };
  }

  function mergeSchemas(pageSchema, actionSchema) {
    const a = pageSchema && typeof pageSchema === "object" ? pageSchema : {};
    const b = actionSchema && typeof actionSchema === "object" ? actionSchema : {};
    return { ...a, ...b };
  }

  function validateWithSchema(raw, schema) {
    if (!schema || typeof schema !== "object") {
      return {
        view: raw != null && typeof raw === "object" ? deepMerge({}, raw) : {},
        blocked: false,
      };
    }
    let view = {};
    if (raw != null && typeof raw === "object") {
      try {
        view = structuredClone(raw);
      } catch {
        view = deepMerge({}, raw);
      }
    }
    let blocked = false;
    for (const [key, rules] of Object.entries(schema)) {
      if (!rules || typeof rules !== "object") continue;
      let val = getByPath(view, key);
      if (val === undefined && rules.default !== undefined) {
        setByPath(view, key, rules.default);
        val = rules.default;
      }
      const required = rules.required === true;
      const current = getByPath(view, key);
      if (required && current === undefined) {
        const err = rules.error || "Required value missing";
        setByPath(view, key + ".error", err);
        blocked = true;
      }
    }
    return { view, blocked };
  }

  function renderList(el, val) {
    const tag = el.tagName.toLowerCase();
    if (tag !== "ol" && tag !== "ul") return;
    if (!Array.isArray(val)) {
      el.textContent = val == null ? "" : String(val);
      return;
    }
    const tmpl = el.querySelector("li");
    el.innerHTML = "";
    for (const item of val) {
      const li = tmpl ? tmpl.cloneNode(false) : document.createElement("li");
      if (tmpl) {
        li.textContent = typeof item === "object" ? JSON.stringify(item) : String(item);
      } else {
        li.textContent = String(item);
      }
      el.appendChild(li);
    }
  }

  function applyKeys(view) {
    document.querySelectorAll("[key]").forEach((el) => {
      const key = el.getAttribute("key");
      if (!key) return;
      const val = getByPath(view, key);
      if (val === undefined) return;
      const tag = el.tagName.toLowerCase();
      if (tag === "img" || tag === "source") {
        el.setAttribute("src", String(val));
      } else if (tag === "ol" || tag === "ul") {
        renderList(el, val);
      } else {
        el.textContent = typeof val === "object" ? JSON.stringify(val) : String(val);
      }
    });
  }

  function navigateToDestination(dest) {
    if (!dest) return;
    if (dest.startsWith("/")) {
      location.assign(dest);
    } else {
      location.assign("/" + dest.replace(/^\/+/, ""));
    }
  }

  function formFieldTree(form) {
    const out = {};
    const fd = new FormData(form);
    for (const [name, value] of fd.entries()) {
      if (!name) continue;
      setByPath(out, name, coerceQueryValue(String(value)));
    }
    return out;
  }

  function wireAction(element, action, project, currentPage) {
    const immediate = action.immediate !== false;
    const tag = element.tagName.toLowerCase();

    async function runAction(submissionExtra) {
      let pkg = {};
      if (action.submission_package) {
        try {
          pkg = await fetchJson(staticDataUrl(action.submission_package));
        } catch {
          pkg = {};
        }
      }
      const urlOverrides = searchParamsToNested(new URLSearchParams(location.search));
      const body = deepMerge(deepMerge(pkg, urlOverrides), submissionExtra || {});
      const res = await postWebhook(body);
      let raw = res.data;
      let pageSch = null;
      let actSch = null;
      if (currentPage && currentPage.response_schema) {
        try {
          pageSch = await fetchJson(staticDataUrl(currentPage.response_schema));
        } catch {
          pageSch = null;
        }
      }
      if (action.response_schema) {
        try {
          actSch = await fetchJson(staticDataUrl(action.response_schema));
        } catch {
          actSch = null;
        }
      }
      const mergedSch = mergeSchemas(pageSch, actSch);
      const { view, blocked } = validateWithSchema(raw, mergedSch);
      applyKeys(view);
      if (blocked) {
        const ex = document.createElement("div");
        ex.setAttribute("role", "alert");
        ex.textContent = "Action blocked: required response fields missing.";
        document.body.prepend(ex);
        return;
      }
      navigateToDestination(action.destination);
    }

    if (tag === "form") {
      if (immediate) {
        element.addEventListener("submit", function (e) {
          e.preventDefault();
        });
        element.querySelectorAll("input, select, textarea").forEach((input) => {
          input.addEventListener("change", function () {
            const one = {};
            if (input.name) setByPath(one, input.name, coerceQueryValue(String(input.value)));
            runAction(one);
          });
        });
      } else {
        element.addEventListener("submit", function (e) {
          e.preventDefault();
          const tree = formFieldTree(element);
          runAction(tree);
        });
      }
      return;
    }

    element.addEventListener("click", function (e) {
      e.preventDefault();
      runAction({});
    });
  }

  async function main() {
    const cfg = await fetchJson("/api/config");
    const project = cfg.project[0];
    if (!project) return;

    const pathname = location.pathname;
    const page = findPage(pathname, project);
    let pageView = {};
    let pageBlocked = false;

    if (page && page.submission_package) {
      let pkg = {};
      try {
        pkg = await fetchJson(staticDataUrl(page.submission_package));
      } catch {
        pkg = {};
      }
      const urlOverrides = searchParamsToNested(new URLSearchParams(location.search));
      const body = deepMerge(pkg, urlOverrides);
      const res = await postWebhook(body);
      let schema = null;
      if (page.response_schema) {
        try {
          schema = await fetchJson(staticDataUrl(page.response_schema));
        } catch {
          schema = null;
        }
      }
      const v = validateWithSchema(res.data, schema);
      pageView = v.view;
      pageBlocked = v.blocked;
      if (pageBlocked) {
        const b = document.createElement("div");
        b.setAttribute("role", "alert");
        b.textContent =
          "This page could not load required data from the endpoint. Check keys with *.error suffix.";
        document.body.prepend(b);
      }
      applyKeys(pageView);
    } else if (page && page.response_schema) {
      try {
        const schema = await fetchJson(staticDataUrl(page.response_schema));
        const v = validateWithSchema({}, schema);
        pageView = v.view;
        pageBlocked = v.blocked;
        applyKeys(pageView);
      } catch {
        /* no-op */
      }
    }

    const actions = project.action_element || [];
    const byId = new Map(actions.map((a) => [a.id, a]));
    document.querySelectorAll("[action-element-id]").forEach((el) => {
      const id = el.getAttribute("action-element-id");
      const act = byId.get(id);
      if (!act) return;
      wireAction(el, act, project, page);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      main().catch(function () {
        /* swallow */
      });
    });
  } else {
    main().catch(function () {
      /* swallow */
    });
  }
})();
