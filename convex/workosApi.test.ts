import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWorkosMembershipPayload,
  buildWorkosOrganizationUpdatePayload,
  extractWorkosInvitation,
  extractWorkosMembership,
  extractWorkosOrganization,
  isInvalidWorkosRoleError,
} from "./workosApi.ts";

test("extractWorkosOrganization accepts direct and wrapped WorkOS responses", () => {
  const direct = { id: "org_123", name: "Main Street Games" };
  const wrapped = { organization: direct };

  assert.deepEqual(extractWorkosOrganization(direct), direct);
  assert.deepEqual(extractWorkosOrganization(wrapped), direct);
});

test("extractWorkosOrganization throws a helpful error for unexpected responses", () => {
  assert.throws(
    () => extractWorkosOrganization({ object: "error" }),
    /WorkOS organization response did not include an organization id/,
  );
});

test("extractWorkosMembership accepts direct and wrapped WorkOS responses", () => {
  const direct = { id: "om_123", status: "active" };

  assert.deepEqual(extractWorkosMembership(direct), direct);
  assert.deepEqual(
    extractWorkosMembership({ organization_membership: direct }),
    direct,
  );
});

test("extractWorkosInvitation accepts direct and wrapped WorkOS responses", () => {
  const direct = { id: "invitation_123", email: "judge@example.com" };

  assert.deepEqual(extractWorkosInvitation(direct), direct);
  assert.deepEqual(extractWorkosInvitation({ invitation: direct }), direct);
});

test("isInvalidWorkosRoleError recognizes WorkOS invalid role errors", () => {
  assert.equal(isInvalidWorkosRoleError(new Error("The role is invalid.")), true);
  assert.equal(isInvalidWorkosRoleError(new Error("Something else")), false);
});

test("buildWorkosMembershipPayload can omit role_slug for default-role fallback", () => {
  assert.deepEqual(
    buildWorkosMembershipPayload({
      organizationId: "org_123",
      userId: "user_123",
      roleSlug: "owner",
    }),
    {
      organization_id: "org_123",
      user_id: "user_123",
      role_slug: "owner",
    },
  );

  assert.deepEqual(
    buildWorkosMembershipPayload({
      organizationId: "org_123",
      userId: "user_123",
      roleSlug: null,
    }),
    {
      organization_id: "org_123",
      user_id: "user_123",
    },
  );
});

test("buildWorkosOrganizationUpdatePayload includes the organization id and name", () => {
  assert.deepEqual(
    buildWorkosOrganizationUpdatePayload({
      organizationId: "org_123",
      name: "Main Street Games",
    }),
    {
      organization: "org_123",
      name: "Main Street Games",
    },
  );
});
