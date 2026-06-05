import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const organizationsSource = readFileSync(
  new URL("./organizations.ts", import.meta.url),
  "utf8",
);
const schemaSource = readFileSync(new URL("./schema.ts", import.meta.url), "utf8");

test("membership authorization uses an organization-scoped active membership index", () => {
  assert.match(
    schemaSource,
    /\.index\("by_organizationId_and_userId_and_status", \[[\s\S]*?"organizationId",[\s\S]*?"userId",[\s\S]*?"status",[\s\S]*?\]\)/,
  );
  assert.doesNotMatch(organizationsSource, /\.filter\(/);
  assert.match(
    organizationsSource,
    /withIndex\("by_organizationId_and_userId_and_status"/,
  );
});
