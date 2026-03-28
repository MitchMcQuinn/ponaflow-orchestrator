#!/usr/bin/env node
import { loadAndValidateConfigSync } from "../config-validator.js";

const r = loadAndValidateConfigSync();
if (r.ok) {
  console.log("config OK");
  process.exit(0);
}
console.error("config validation failed:");
for (const e of r.errors) console.error(`  - ${e}`);
process.exit(1);
