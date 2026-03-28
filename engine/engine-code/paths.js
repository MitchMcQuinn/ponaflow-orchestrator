import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repo root: …/ponaflow-orchestrator */
export const REPO_ROOT = path.resolve(__dirname, "../..");

export const PROJECT_DIR = path.join(REPO_ROOT, "project");
export const CONFIG_PATH = path.join(PROJECT_DIR, "config", "config.json");
export const STATIC_ROOT = path.join(PROJECT_DIR, "project-code");

/**
 * Submission/response JSON paths in config are relative to project/ (leading slash optional).
 */
export function resolveProjectDataPath(relative) {
  if (!relative || typeof relative !== "string") return null;
  const trimmed = relative.replace(/^\//, "");
  return path.join(PROJECT_DIR, trimmed);
}

/**
 * page_html, landing_page, destination paths: relative to project/project-code.
 */
export function resolveStaticPath(relative) {
  if (!relative || typeof relative !== "string") return null;
  const trimmed = relative.replace(/^\//, "");
  return path.join(STATIC_ROOT, trimmed);
}
