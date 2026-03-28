import fs from "node:fs";
import path from "node:path";
import {
  CONFIG_PATH,
  resolveProjectDataPath,
  resolveStaticPath,
} from "./paths.js";

function readJsonIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return { ok: false, error: "missing" };
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return { ok: true, data: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function fileExistsUnderStatic(relative) {
  const full = resolveStaticPath(relative);
  return full && fs.existsSync(full) && fs.statSync(full).isFile();
}

function slugDestinations(project) {
  const map = new Map();
  for (const p of project.page || []) {
    if (p.slug) map.set(p.slug, p);
  }
  return map;
}

/**
 * @param {unknown} config
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateConfig(config) {
  const errors = [];

  if (!config || typeof config !== "object") {
    return { ok: false, errors: ["config must be a JSON object"] };
  }

  const projects = config.project;
  if (!Array.isArray(projects) || projects.length !== 1) {
    errors.push("project must be an array with exactly one entry");
    return { ok: false, errors };
  }

  const project = projects[0];
  if (!project || typeof project !== "object") {
    errors.push("project[0] must be an object");
    return { ok: false, errors };
  }

  const requiredTop = ["name", "landing_page", "webhook_url", "page", "action_element"];
  for (const k of requiredTop) {
    if (!(k in project)) errors.push(`missing required field: project.${k}`);
  }

  if (!Array.isArray(project.page)) errors.push("project.page must be an array");
  if (!Array.isArray(project.action_element)) errors.push("project.action_element must be an array");

  if (errors.length) return { ok: false, errors };

  if (typeof project.webhook_url !== "string" || !project.webhook_url.trim()) {
    errors.push("project.webhook_url must be a non-empty string");
  }

  if (!fileExistsUnderStatic(project.landing_page)) {
    errors.push(`landing_page file not found under project/project-code: ${project.landing_page}`);
  }

  const slugs = new Set();
  let landingMatched = false;

  for (const p of project.page) {
    if (!p || typeof p !== "object") {
      errors.push("each page must be an object");
      continue;
    }
    if (!p.slug || typeof p.slug !== "string") errors.push("each page must have a string slug");
    if (!p.page_html || typeof p.page_html !== "string") {
      errors.push(`page ${p.slug || "?"} must have page_html`);
    } else if (!fileExistsUnderStatic(p.page_html)) {
      errors.push(`page_html not found: ${p.page_html}`);
    }
    if (p.slug) {
      if (slugs.has(p.slug)) errors.push(`duplicate page slug: ${p.slug}`);
      slugs.add(p.slug);
    }
    if (p.page_html === project.landing_page) landingMatched = true;

    if (p.submission_package) {
      const sp = resolveProjectDataPath(p.submission_package);
      const j = readJsonIfExists(sp);
      if (!j.ok) errors.push(`page ${p.slug}: submission_package invalid: ${p.submission_package} (${j.error})`);
    }
    if (p.response_schema) {
      const rp = resolveProjectDataPath(p.response_schema);
      const j = readJsonIfExists(rp);
      if (!j.ok) errors.push(`page ${p.slug}: response_schema invalid: ${p.response_schema} (${j.error})`);
    }
  }

  if (!landingMatched) {
    errors.push("landing_page must match page_html of at least one page");
  }

  const slugMap = slugDestinations(project);
  const actionIds = new Set();

  for (const a of project.action_element) {
    if (!a || typeof a !== "object") {
      errors.push("each action_element must be an object");
      continue;
    }
    if (!a.id || typeof a.id !== "string") errors.push("action_element missing id");
    else {
      if (actionIds.has(a.id)) errors.push(`duplicate action_element id: ${a.id}`);
      actionIds.add(a.id);
    }
    if (!a.destination || typeof a.destination !== "string") {
      errors.push(`action_element ${a.id || "?"}: destination required`);
    } else {
      const dest = a.destination;
      if (dest.startsWith("/")) {
        if (!slugMap.has(dest)) {
          errors.push(`action_element ${a.id}: destination slug not found: ${dest}`);
        }
      } else if (!fileExistsUnderStatic(dest)) {
        errors.push(`action_element ${a.id}: destination file not found: ${dest}`);
      }
    }

    if (a.submission_package) {
      const sp = resolveProjectDataPath(a.submission_package);
      const j = readJsonIfExists(sp);
      if (!j.ok) {
        errors.push(`action_element ${a.id}: submission_package invalid (${j.error})`);
      }
    }
    if (a.response_schema) {
      const rp = resolveProjectDataPath(a.response_schema);
      const j = readJsonIfExists(rp);
      if (!j.ok) {
        errors.push(`action_element ${a.id}: response_schema invalid (${j.error})`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

export function loadAndValidateConfigSync() {
  const j = readJsonIfExists(CONFIG_PATH);
  if (!j.ok) {
    return { ok: false, errors: [`config: ${CONFIG_PATH}: ${j.error}`], config: null };
  }
  const v = validateConfig(j.data);
  if (!v.ok) return { ok: false, errors: v.errors, config: j.data };
  return { ok: true, errors: [], config: j.data };
}
