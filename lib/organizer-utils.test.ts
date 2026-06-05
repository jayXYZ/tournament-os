import assert from "node:assert/strict";
import test from "node:test";

import {
  canInviteMembers,
  normalizeInviteEmail,
  slugifyOrganizationName,
  toInvitationStatus,
  toMembershipStatus,
  toOrganizerRole,
  toOrganizerRoleFromWorkosFields,
} from "./organizer-utils.ts";

test("slugifyOrganizationName creates stable slugs from organizer names", () => {
  assert.equal(slugifyOrganizationName("  Friday Night Magic @ Main St.  "), "friday-night-magic-main-st");
  assert.equal(slugifyOrganizationName("!!!"), "organizer");
});

test("canInviteMembers allows only owner and admin roles", () => {
  assert.equal(canInviteMembers("owner"), true);
  assert.equal(canInviteMembers("admin"), true);
  assert.equal(canInviteMembers("staff"), false);
});

test("normalizeInviteEmail trims and lowercases emails", () => {
  assert.equal(normalizeInviteEmail("  Judge@OneExample.COM "), "judge@oneexample.com");
});

test("toMembershipStatus only exposes known lifecycle states", () => {
  assert.equal(toMembershipStatus("active"), "active");
  assert.equal(toMembershipStatus("inactive"), "inactive");
  assert.equal(toMembershipStatus("pending"), "pending");
  assert.equal(toMembershipStatus("unknown"), "pending");
});

test("toOrganizerRole reads supported WorkOS role shapes and defaults safely", () => {
  assert.equal(toOrganizerRole({ slug: "owner" }), "owner");
  assert.equal(toOrganizerRole({ slug: "admin" }), "admin");
  assert.equal(toOrganizerRole("staff"), "staff");
  assert.equal(toOrganizerRole({ slug: "unknown" }), "staff");
  assert.equal(toOrganizerRole(undefined), "staff");
});

test("toOrganizerRoleFromWorkosFields uses WorkOS field precedence", () => {
  assert.equal(toOrganizerRoleFromWorkosFields({ role: { slug: "owner" } }), "owner");
  assert.equal(toOrganizerRoleFromWorkosFields({ roles: [{ slug: "admin" }] }), "admin");
  assert.equal(
    toOrganizerRoleFromWorkosFields({ role: { slug: "unknown" }, role_slug: "admin" }),
    "admin",
  );
  assert.equal(toOrganizerRoleFromWorkosFields({ roleSlug: "staff" }), "staff");
  assert.equal(toOrganizerRoleFromWorkosFields({ role_slug: "unknown" }), "staff");
});

test("toInvitationStatus only exposes known invitation lifecycle states", () => {
  assert.equal(toInvitationStatus("pending"), "pending");
  assert.equal(toInvitationStatus("accepted"), "accepted");
  assert.equal(toInvitationStatus("revoked"), "revoked");
  assert.equal(toInvitationStatus("expired"), "expired");
  assert.equal(toInvitationStatus("unknown"), "pending");
});
