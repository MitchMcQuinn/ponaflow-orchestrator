import test from "node:test";
import assert from "node:assert/strict";
import { validateConfig } from "../engine/engine-code/config-validator.js";

const minimalValid = {
  project: [
    {
      name: "T",
      landing_page: "html/landing.html",
      webhook_url: "https://example.com/h",
      page: [{ slug: "/a", page_html: "html/landing.html" }],
      action_element: [
        {
          id: "x",
          destination: "/a",
          submission_package: "json/submission/step1.json",
          response_schema: "json/response-schema/thank-you.json",
        },
      ],
    },
  ],
};

test("validateConfig accepts minimal valid fixture shape", () => {
  const r = validateConfig(minimalValid);
  assert.equal(r.ok, true, r.errors.join("; "));
});

test("validateConfig rejects non-object", () => {
  const r = validateConfig(null);
  assert.equal(r.ok, false);
});

test("validateConfig rejects wrong project count", () => {
  const r = validateConfig({ project: [] });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("exactly one")));
});

test("validateConfig rejects duplicate page slugs", () => {
  const bad = structuredClone(minimalValid);
  bad.project[0].page.push({ slug: "/a", page_html: "html/landing.html" });
  const r = validateConfig(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("duplicate page slug")));
});

test("validateConfig rejects duplicate action ids", () => {
  const bad = structuredClone(minimalValid);
  bad.project[0].action_element.push({
    id: "x",
    destination: "/a",
    submission_package: "json/submission/step1.json",
    response_schema: "json/response-schema/thank-you.json",
  });
  const r = validateConfig(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("duplicate action_element id")));
});

test("validateConfig rejects unknown destination slug", () => {
  const bad = structuredClone(minimalValid);
  bad.project[0].action_element[0].destination = "/nope";
  const r = validateConfig(bad);
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes("not found")));
});
