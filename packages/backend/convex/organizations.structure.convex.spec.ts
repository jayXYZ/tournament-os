// @vitest-environment node
import { readFileSync } from "node:fs";

import { expect, test } from "vitest";

const organizationsSource = readFileSync(
  new URL("./organizations.ts", import.meta.url),
  "utf8",
);
const accessModelSource = readFileSync(
  new URL("./model/access.ts", import.meta.url),
  "utf8",
);
const schemaSource = readFileSync(new URL("./schema.ts", import.meta.url), "utf8");

test("membership authorization uses an organization-scoped active membership index", () => {
  expect(schemaSource).toMatch(
    /\.index\("by_organizationId_and_userId_and_status", \[[\s\S]*?"organizationId",[\s\S]*?"userId",[\s\S]*?"status",[\s\S]*?\]\)/,
  );
  expect(organizationsSource).not.toMatch(/\.filter\(/);
  expect(accessModelSource).not.toMatch(/\.filter\(/);
  expect(accessModelSource).toMatch(
    /withIndex\("by_organizationId_and_userId_and_status"/,
  );
});

test("organizations store optional profile image storage ids", () => {
  expect(schemaSource).toMatch(
    /profileImageStorageId: v\.optional\(v\.id\("_storage"\)\)/,
  );
});

test("organization profile functions enforce owner or admin access without filters", () => {
  expect(organizationsSource).not.toMatch(/\.filter\(/);
  expect(accessModelSource).toMatch(/canManageOrganizationProfile/);
  expect(organizationsSource).toMatch(/requireProfilePermission/);
  expect(organizationsSource).toMatch(/generateProfileImageUploadUrl/);
  expect(organizationsSource).toMatch(/updateProfileImage/);
  expect(organizationsSource).toMatch(/updateProfile/);
  expect(organizationsSource).toMatch(/archiveOrganization/);
});

test("organization profile image metadata is validated before attachment", () => {
  expect(organizationsSource).toMatch(
    /ctx\.db\.system\.get\("_storage", args\.profileImageStorageId\)/,
  );
  expect(organizationsSource).toMatch(/validateOrganizationProfileImageDetails/);
  expect(organizationsSource).toMatch(
    /profileImageStorageId: args\.profileImageStorageId/,
  );
});

test("organization archive is a soft delete", () => {
  expect(organizationsSource).toMatch(/status: "archived"/);
  expect(organizationsSource).not.toMatch(/deleteOrganization/);
});
