import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAndValidateConfigSync, validateConfig } from "./config-validator.js";
import {
  createHtmlPage,
  createJsonDataFile,
  ensureBuilderDirs,
  listBuilderResources,
} from "./builder-resources.js";
import { PROJECT_DIR, STATIC_ROOT, resolveStaticPath } from "./paths.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RUNTIME_PATH = path.join(__dirname, "runtime", "ponaflow-runtime.js");
const BUILDER_PATH = path.join(__dirname, "builder", "index.html");

const DEFAULT_PORT = 3847;
/** If PORT is set in the environment, fail fast on conflict; otherwise try next free port. */
const EXPLICIT_PORT = process.env.PORT !== undefined && String(process.env.PORT).length > 0;
let listenPort = EXPLICIT_PORT ? Number(process.env.PORT) : DEFAULT_PORT;
if (EXPLICIT_PORT && (!Number.isInteger(listenPort) || listenPort < 1 || listenPort > 65535)) {
  console.error(`Invalid PORT: ${process.env.PORT}`);
  process.exit(1);
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    ...headers,
  });
  res.end(body);
}

function sendJson(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function sanitizeProject(project) {
  if (!project || typeof project !== "object") return project;
  const { webhook_url: _omit, ...rest } = project;
  return rest;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}

function injectRuntime(html) {
  const tag = '<script src="/ponaflow-runtime.js" defer></script>';
  if (html.includes("</body>")) {
    return html.replace("</body>", `  ${tag}\n</body>`);
  }
  return `${html}\n${tag}\n`;
}

function isProbablyHtml(filePath) {
  return filePath.endsWith(".html") || filePath.endsWith(".htm");
}

function longestSlugMatch(pathname, pages) {
  let best = null;
  let bestLen = -1;
  for (const p of pages) {
    if (!p.slug) continue;
    const s = p.slug;
    if (pathname === s || pathname.startsWith(s + "/")) {
      if (s.length > bestLen) {
        bestLen = s.length;
        best = p;
      }
    }
  }
  return best;
}

function urlPathToFilesystemPath(urlPath) {
  const decoded = decodeURIComponent(urlPath);
  const safe = path.normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, "");
  const full = path.join(STATIC_ROOT, safe);
  if (!full.startsWith(STATIC_ROOT)) return null;
  return full;
}

/** Serve files under project/ (e.g. sample/*.json) at /__ponaflow/<relative> */
function urlPathToProjectPath(urlPath) {
  if (!urlPath.startsWith("/__ponaflow/")) return null;
  const decoded = decodeURIComponent(urlPath.slice("/__ponaflow/".length));
  const safe = path.normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, "");
  const full = path.join(PROJECT_DIR, safe);
  if (!full.startsWith(PROJECT_DIR)) return null;
  return full;
}

async function handleWebhook(webhookUrl, body, res) {
  try {
    const upstream = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await upstream.text();
    let payload = text;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = text;
    }
    sendJson(res, upstream.status, typeof payload === "object" && payload !== null ? payload : { raw: payload });
  } catch (e) {
    sendJson(res, 502, { error: "webhook_proxy_failed", message: String(e.message || e) });
  }
}

const loadResult = loadAndValidateConfigSync();
if (!loadResult.ok) {
  console.error("Invalid config; fix project/config/config.json before starting:");
  for (const e of loadResult.errors) console.error(`  ${e}`);
  process.exit(1);
}

ensureBuilderDirs();

const config = loadResult.config;
const project = config.project[0];
const webhookUrl = project.webhook_url;

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

  if (req.method === "GET" && u.pathname === "/api/config") {
    return sendJson(res, 200, { project: [sanitizeProject(project)] });
  }

  if (req.method === "POST" && u.pathname === "/api/webhook") {
    try {
      const body = await readBody(req);
      return handleWebhook(webhookUrl, body ?? {}, res);
    } catch {
      return sendJson(res, 400, { error: "invalid_json" });
    }
  }

  if (req.method === "POST" && u.pathname === "/api/validate") {
    try {
      const body = await readBody(req);
      if (body == null || typeof body !== "object" || Array.isArray(body)) {
        return sendJson(res, 400, { ok: false, errors: ["expected JSON object"] });
      }
      const v = validateConfig(body);
      return sendJson(res, 200, v);
    } catch {
      return sendJson(res, 400, { ok: false, errors: ["invalid_json"] });
    }
  }

  if (req.method === "GET" && u.pathname === "/api/builder/resources") {
    try {
      return sendJson(res, 200, listBuilderResources());
    } catch (e) {
      return sendJson(res, 500, { ok: false, error: String(e.message || e) });
    }
  }

  if (req.method === "POST" && u.pathname === "/api/builder/create-html") {
    try {
      const body = await readBody(req);
      const name = body && typeof body.name === "string" ? body.name : "";
      const out = createHtmlPage(name);
      if (!out.ok) return sendJson(res, 400, out);
      return sendJson(res, 200, out);
    } catch {
      return sendJson(res, 400, { ok: false, error: "invalid_json" });
    }
  }

  if (req.method === "POST" && u.pathname === "/api/builder/create-json") {
    try {
      const body = await readBody(req);
      const kind = body && typeof body.kind === "string" ? body.kind : "";
      const name = body && typeof body.name === "string" ? body.name : "";
      const out = createJsonDataFile(kind, name);
      if (!out.ok) return sendJson(res, 400, out);
      return sendJson(res, 200, out);
    } catch {
      return sendJson(res, 400, { ok: false, error: "invalid_json" });
    }
  }

  if (req.method === "GET" && u.pathname === "/ponaflow-runtime.js") {
    try {
      const js = fs.readFileSync(RUNTIME_PATH, "utf8");
      res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8" });
      return res.end(js);
    } catch {
      return send(res, 404, "runtime not found");
    }
  }

  if (req.method === "GET" && u.pathname.startsWith("/__ponaflow/")) {
    const projPath = urlPathToProjectPath(u.pathname);
    if (!projPath || !fs.existsSync(projPath) || !fs.statSync(projPath).isFile()) {
      return send(res, 404, "not found");
    }
    const ext = path.extname(projPath).toLowerCase();
    const ct =
      ext === ".json" ? "application/json; charset=utf-8" : "application/octet-stream";
    res.writeHead(200, { "Content-Type": ct });
    return res.end(fs.readFileSync(projPath));
  }

  if (req.method === "GET" && (u.pathname === "/build" || u.pathname === "/build/")) {
    try {
      const html = fs.readFileSync(BUILDER_PATH, "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(html);
    } catch {
      return send(res, 404, "builder not found");
    }
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return send(res, 405, "method not allowed");
  }

  let pathname = u.pathname;
  if (pathname === "/" || pathname === "") {
    const landing = (project.page || []).find((p) => p.page_html === project.landing_page);
    if (landing) {
      const full = resolveStaticPath(project.landing_page);
      if (full && fs.existsSync(full)) {
        let html = fs.readFileSync(full, "utf8");
        html = injectRuntime(html);
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(html);
      }
    }
  }

  let filePath = urlPathToFilesystemPath(pathname);

  if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    if (isProbablyHtml(filePath)) {
      let html = fs.readFileSync(filePath, "utf8");
      html = injectRuntime(html);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(html);
    }
    const ext = path.extname(filePath).toLowerCase();
    const types = {
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".gif": "image/gif",
      ".svg": "image/svg+xml",
      ".ico": "image/x-icon",
      ".webp": "image/webp",
      ".woff": "font/woff",
      ".woff2": "font/woff2",
    };
    const ct = types[ext] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": ct });
    return res.end(fs.readFileSync(filePath));
  }

  const pageMatch = longestSlugMatch(u.pathname, project.page || []);
  if (pageMatch && pageMatch.page_html) {
    const full = resolveStaticPath(pageMatch.page_html);
    if (full && fs.existsSync(full)) {
      let html = fs.readFileSync(full, "utf8");
      html = injectRuntime(html);
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(html);
    }
  }

  send(res, 404, "not found");
});

function bind() {
  server.listen(listenPort, () => {
    const addr = server.address();
    const p = typeof addr === "object" && addr ? addr.port : listenPort;
    console.log(`ponaflow server http://localhost:${p}`);
  });
}

server.on("error", (err) => {
  if (err && err.code !== "EADDRINUSE") {
    throw err;
  }
  if (EXPLICIT_PORT) {
    console.error(
      `Port ${listenPort} is already in use. Stop the other process or pick another port, e.g. PORT=3848 npm start`
    );
    process.exit(1);
  }
  listenPort += 1;
  if (listenPort > DEFAULT_PORT + 30) {
    console.error("Could not find a free port (tried many above default). Set PORT explicitly.");
    process.exit(1);
  }
  console.warn(`Port ${listenPort - 1} is in use, trying ${listenPort}…`);
  bind();
});

bind();
