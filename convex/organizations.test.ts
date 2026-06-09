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

test("organizations store optional profile image storage ids", () => {
  assert.match(
    schemaSource,
    /profileImageStorageId: v\.optional\(v\.id\("_storage"\)\)/,
  );
});

test("organization profile functions enforce owner or admin access without filters", () => {
  assert.doesNotMatch(organizationsSource, /\.filter\(/);
  assert.match(organizationsSource, /canManageOrganizationProfile/);
  assert.match(organizationsSource, /generateProfileImageUploadUrl/);
  assert.match(organizationsSource, /updateProfileImage/);
  assert.match(organizationsSource, /updateProfile/);
  assert.match(organizationsSource, /archiveOrganization/);
  assert.match(
    organizationsSource,
    /withIndex\("by_organizationId_and_userId_and_status"/,
  );
});

test("organization profile image metadata is validated before attachment", () => {
  assert.match(
    organizationsSource,
    /ctx\.db\.system\.get\("_storage", args\.profileImageStorageId\)/,
  );
  assert.match(organizationsSource, /validateOrganizationProfileImageDetails/);
  assert.match(
    organizationsSource,
    /profileImageStorageId: args\.profileImageStorageId/,
  );
});

test("organization archive is a soft delete and does not call WorkOS delete", () => {
  assert.match(organizationsSource, /status: "archived"/);
  assert.doesNotMatch(organizationsSource, /deleteWorkosOrganization/);
  assert.doesNotMatch(organizationsSource, /deleteOrganization/);
});
