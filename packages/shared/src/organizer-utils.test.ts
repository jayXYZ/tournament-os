import assert from "node:assert/strict";
import { test } from "vitest";

import {
  canInviteMembers,
  canManageOrganizationProfile,
  normalizeInviteEmail,
  slugifyOrganizationName,
} from "./organizer-utils.ts";

test("slugifyOrganizationName creates stable slugs from organizer names", () => {
  assert.equal(
    slugifyOrganizationName("  Friday Night Magic @ Main St.  "),
    "friday-night-magic-main-st",
  );
  assert.equal(slugifyOrganizationName("!!!"), "organizer");
});

test("canInviteMembers allows only owner and admin roles", () => {
  assert.equal(canInviteMembers("owner"), true);
  assert.equal(canInviteMembers("admin"), true);
  assert.equal(canInviteMembers("staff"), false);
});

test("canManageOrganizationProfile allows only owner and admin roles", () => {
  assert.equal(canManageOrganizationProfile("owner"), true);
  assert.equal(canManageOrganizationProfile("admin"), true);
  assert.equal(canManageOrganizationProfile("staff"), false);
});

test("normalizeInviteEmail trims and lowercases emails", () => {
  assert.equal(
    normalizeInviteEmail("  Judge@OneExample.COM "),
    "judge@oneexample.com",
  );
});
