# Organization Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an organizer workspace organization profile page where owners/admins can rename, upload a constrained profile picture, and archive the selected organization.

**Architecture:** Keep `OrganizerWorkspace` as the client orchestration boundary and add a focused `OrganizationProfileView` UI module. Convex owns authorization, storage metadata validation, organization updates, and archive state; a Convex action syncs organization name changes to WorkOS because it performs external network I/O. Image rules live in a shared helper so frontend validation and backend validation use the same constants.

**Tech Stack:** Next.js 16 App Router, React 19, Convex queries/mutations/actions/storage, WorkOS Organization API, shadcn/ui components, Vitest/node:test source tests.

---

## File Structure

- Modify `lib/organizer-utils.ts`: add `canManageOrganizationProfile`.
- Modify `lib/organizer-utils.test.ts`: prove owners/admins can manage profile and staff cannot.
- Create `lib/organization-profile-image.ts`: profile image MIME, size, and dimension constants plus pure validation helpers.
- Create `lib/organization-profile-image.test.ts`: validate the image helper without browser APIs.
- Modify `convex/workosApi.ts`: support WorkOS organization update via `PUT /organizations/:id`.
- Modify `convex/workosApi.test.ts`: test WorkOS update payload extraction.
- Modify `convex/schema.ts`: add optional `profileImageStorageId`.
- Modify `convex/organizations.ts`: add profile reads, upload URL, image update, name update, and archive behavior.
- Modify `convex/organizations.test.ts`: source-level tests for schema/functions/authorization/index usage.
- Modify `app/components/organizer-workspace/types.ts`: add the `organization` admin view and profile-image URL-bearing organization shape.
- Modify `app/components/organizer-workspace/admin-sidebar.tsx`: add an Organization sidebar link.
- Create `app/admin/organization/page.tsx`: authenticated route wrapper for the organization profile view.
- Modify `app/components/organizer-workspace.tsx`: wire profile state, handlers, and view rendering.
- Create `app/components/organizer-workspace/organization-profile-view.tsx`: organization profile UI.
- Modify `app/components/organizer-workspace.test.ts`: source-level wiring tests.

## Task 1: Shared Organization Profile Helpers

**Files:**
- Modify: `lib/organizer-utils.ts`
- Modify: `lib/organizer-utils.test.ts`
- Create: `lib/organization-profile-image.ts`
- Create: `lib/organization-profile-image.test.ts`

- [ ] **Step 1: Write failing helper tests**

Add this import to `lib/organizer-utils.test.ts`:

```ts
import {
  canInviteMembers,
  canManageOrganizationProfile,
  normalizeInviteEmail,
  slugifyOrganizationName,
  toInvitationStatus,
  toMembershipStatus,
  toOrganizerRole,
  toOrganizerRoleFromWorkosFields,
} from "./organizer-utils.ts";
```

Add this test to `lib/organizer-utils.test.ts`:

```ts
test("canManageOrganizationProfile allows only owner and admin roles", () => {
  assert.equal(canManageOrganizationProfile("owner"), true);
  assert.equal(canManageOrganizationProfile("admin"), true);
  assert.equal(canManageOrganizationProfile("staff"), false);
});
```

Create `lib/organization-profile-image.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_ORGANIZATION_PROFILE_IMAGE_BYTES,
  MIN_ORGANIZATION_PROFILE_IMAGE_DIMENSION,
  ORGANIZATION_PROFILE_IMAGE_TYPES,
  validateOrganizationProfileImageDetails,
} from "./organization-profile-image.ts";

test("organization profile image constants expose the accepted constraints", () => {
  assert.deepEqual(ORGANIZATION_PROFILE_IMAGE_TYPES, [
    "image/png",
    "image/jpeg",
    "image/webp",
  ]);
  assert.equal(MAX_ORGANIZATION_PROFILE_IMAGE_BYTES, 2 * 1024 * 1024);
  assert.equal(MIN_ORGANIZATION_PROFILE_IMAGE_DIMENSION, 256);
});

test("validateOrganizationProfileImageDetails accepts supported square-enough images", () => {
  assert.equal(
    validateOrganizationProfileImageDetails({
      type: "image/png",
      size: 120_000,
      width: 512,
      height: 512,
    }),
    null,
  );
});

test("validateOrganizationProfileImageDetails rejects unsupported types", () => {
  assert.equal(
    validateOrganizationProfileImageDetails({
      type: "image/gif",
      size: 120_000,
      width: 512,
      height: 512,
    }),
    "Upload a PNG, JPEG, or WebP image.",
  );
});

test("validateOrganizationProfileImageDetails rejects oversized files", () => {
  assert.equal(
    validateOrganizationProfileImageDetails({
      type: "image/jpeg",
      size: MAX_ORGANIZATION_PROFILE_IMAGE_BYTES + 1,
      width: 512,
      height: 512,
    }),
    "Profile pictures must be 2 MB or smaller.",
  );
});

test("validateOrganizationProfileImageDetails rejects images below the minimum dimensions", () => {
  assert.equal(
    validateOrganizationProfileImageDetails({
      type: "image/webp",
      size: 120_000,
      width: 255,
      height: 512,
    }),
    "Profile pictures must be at least 256 x 256 pixels.",
  );
});
```

- [ ] **Step 2: Run helper tests to verify they fail**

Run:

```bash
pnpm exec vitest run lib/organizer-utils.test.ts lib/organization-profile-image.test.ts
```

Expected: FAIL because `canManageOrganizationProfile` and `organization-profile-image.ts` do not exist yet.

- [ ] **Step 3: Implement shared helpers**

Add this function to `lib/organizer-utils.ts` after `canInviteMembers`:

```ts
export function canManageOrganizationProfile(role: OrganizerRole) {
  return role === "owner" || role === "admin";
}
```

Create `lib/organization-profile-image.ts`:

```ts
export const ORGANIZATION_PROFILE_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export const MAX_ORGANIZATION_PROFILE_IMAGE_BYTES = 2 * 1024 * 1024;
export const MIN_ORGANIZATION_PROFILE_IMAGE_DIMENSION = 256;

export type OrganizationProfileImageType =
  (typeof ORGANIZATION_PROFILE_IMAGE_TYPES)[number];

export type OrganizationProfileImageDetails = {
  type?: string;
  size: number;
  width?: number;
  height?: number;
};

export function isOrganizationProfileImageType(
  type: string | undefined,
): type is OrganizationProfileImageType {
  return ORGANIZATION_PROFILE_IMAGE_TYPES.includes(
    type as OrganizationProfileImageType,
  );
}

export function validateOrganizationProfileImageDetails(
  details: OrganizationProfileImageDetails,
) {
  if (!isOrganizationProfileImageType(details.type)) {
    return "Upload a PNG, JPEG, or WebP image.";
  }

  if (details.size > MAX_ORGANIZATION_PROFILE_IMAGE_BYTES) {
    return "Profile pictures must be 2 MB or smaller.";
  }

  if (
    typeof details.width === "number" &&
    typeof details.height === "number" &&
    (details.width < MIN_ORGANIZATION_PROFILE_IMAGE_DIMENSION ||
      details.height < MIN_ORGANIZATION_PROFILE_IMAGE_DIMENSION)
  ) {
    return "Profile pictures must be at least 256 x 256 pixels.";
  }

  return null;
}
```

- [ ] **Step 4: Run helper tests to verify they pass**

Run:

```bash
pnpm exec vitest run lib/organizer-utils.test.ts lib/organization-profile-image.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit helper changes**

Run:

```bash
git add lib/organizer-utils.ts lib/organizer-utils.test.ts lib/organization-profile-image.ts lib/organization-profile-image.test.ts
git commit -m "Add organization profile validation helpers"
```

## Task 2: WorkOS Organization Name Update Helper

**Files:**
- Modify: `convex/workosApi.ts`
- Modify: `convex/workosApi.test.ts`

- [ ] **Step 1: Write failing WorkOS helper tests**

Update the import in `convex/workosApi.test.ts`:

```ts
import {
  buildWorkosMembershipPayload,
  buildWorkosOrganizationUpdatePayload,
  extractWorkosInvitation,
  extractWorkosMembership,
  extractWorkosOrganization,
  isInvalidWorkosRoleError,
} from "./workosApi.ts";
```

Add this test:

```ts
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
```

- [ ] **Step 2: Run WorkOS tests to verify they fail**

Run:

```bash
pnpm exec vitest run convex/workosApi.test.ts
```

Expected: FAIL because `buildWorkosOrganizationUpdatePayload` is not exported.

- [ ] **Step 3: Implement WorkOS update support**

Change `workosRequest` in `convex/workosApi.ts` to accept a method:

```ts
async function workosRequest<T>(
  path: string,
  body: WorkosObject,
  method: "POST" | "PUT" = "POST",
) {
  const response = await fetch(`${WORKOS_API_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${workosApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = (await response.json()) as WorkosObject;

  if (!response.ok) {
    const message =
      typeof json.message === "string"
        ? json.message
        : `WorkOS request failed with status ${response.status}`;
    throw new Error(message);
  }

  return json as T;
}
```

Add these exports after `createWorkosOrganization`:

```ts
export async function updateWorkosOrganization(args: {
  organizationId: string;
  name: string;
}) {
  const response = await workosRequest<WorkosObject>(
    `/organizations/${args.organizationId}`,
    { name: args.name },
    "PUT",
  );
  return extractWorkosOrganization(response);
}

export function buildWorkosOrganizationUpdatePayload(args: {
  organizationId: string;
  name: string;
}) {
  return {
    organization: args.organizationId,
    name: args.name,
  };
}
```

- [ ] **Step 4: Run WorkOS tests to verify they pass**

Run:

```bash
pnpm exec vitest run convex/workosApi.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit WorkOS helper changes**

Run:

```bash
git add convex/workosApi.ts convex/workosApi.test.ts
git commit -m "Add WorkOS organization update helper"
```

## Task 3: Convex Organization Profile Backend

**Files:**
- Modify: `convex/schema.ts`
- Modify: `convex/organizations.ts`
- Modify: `convex/organizations.test.ts`

- [ ] **Step 1: Write failing Convex source tests**

Add these assertions to `convex/organizations.test.ts`:

```ts
test("organizations store optional profile image storage ids", () => {
  assert.match(schemaSource, /profileImageStorageId: v\.optional\(v\.id\("_storage"\)\)/);
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
  assert.match(organizationsSource, /ctx\.db\.system\.get\("_storage", args\.profileImageStorageId\)/);
  assert.match(organizationsSource, /validateOrganizationProfileImageDetails/);
  assert.match(organizationsSource, /profileImageStorageId: args\.profileImageStorageId/);
});

test("organization archive is a soft delete and does not call WorkOS delete", () => {
  assert.match(organizationsSource, /status: "archived"/);
  assert.doesNotMatch(organizationsSource, /deleteWorkosOrganization/);
  assert.doesNotMatch(organizationsSource, /deleteOrganization/);
});
```

- [ ] **Step 2: Run Convex source tests to verify they fail**

Run:

```bash
pnpm exec vitest run convex/organizations.test.ts
```

Expected: FAIL because the schema field and profile functions do not exist.

- [ ] **Step 3: Implement schema and imports**

In `convex/schema.ts`, add this field to the `organizations` table after `slug`:

```ts
profileImageStorageId: v.optional(v.id("_storage")),
```

In `convex/organizations.ts`, update imports:

```ts
import { v } from "convex/values";

import {
  isOrganizationProfileImageType,
  validateOrganizationProfileImageDetails,
} from "../lib/organization-profile-image";
```

Update the organizer utils import:

```ts
import {
  canInviteMembers,
  canManageOrganizationProfile,
  invitationStatusValidator,
  membershipStatusValidator,
  normalizeEmail,
  normalizeMembershipStatus,
  organizerInviteRoleValidator,
  organizerRoleValidator,
  slugifyOrganizationName,
} from "./validators";
```

Update `convex/validators.ts` to export the permission helper:

```ts
export {
  canInviteMembers,
  canManageOrganizationProfile,
  normalizeInviteEmail as normalizeEmail,
  slugifyOrganizationName,
  toMembershipStatus as normalizeMembershipStatus,
} from "../lib/organizer-utils";
```

- [ ] **Step 4: Add profile URL mapping helpers**

Add these helpers near the bottom of `convex/organizations.ts`:

```ts
async function organizationWithProfileImageUrl(
  ctx: QueryCtx,
  organization: Doc<"organizations">,
) {
  const profileImageUrl = organization.profileImageStorageId
    ? await ctx.storage.getUrl(organization.profileImageStorageId)
    : null;

  return {
    ...organization,
    profileImageUrl,
  };
}

async function requireProfilePermission(
  ctx: QueryCtx,
  organizationId: Id<"organizations">,
) {
  const identity = await requireIdentity(ctx);
  const user = await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier),
    )
    .unique();
  if (!user) {
    throw new Error("Not authenticated");
  }

  const membership = await getActiveMembershipForOrganization(
    ctx,
    organizationId,
    user._id,
  );
  if (!membership || !canManageOrganizationProfile(membership.role)) {
    throw new Error("Unauthorized");
  }

  const organization = await ctx.db.get(organizationId);
  if (!organization || organization.status !== "active") {
    throw new Error("Organization not found");
  }

  return { organization, membership, user };
}
```

Update `listMine` row pushes:

```ts
rows.push({
  organization: await organizationWithProfileImageUrl(ctx, organization),
  membership,
});
```

Update `getById` return:

```ts
return {
  organization: await organizationWithProfileImageUrl(ctx, organization),
  membership,
};
```

- [ ] **Step 5: Add profile mutations and action**

Add these functions to `convex/organizations.ts` after `inviteMember`:

```ts
export const generateProfileImageUploadUrl = mutation({
  args: { organizationId: v.id("organizations") },
  handler: async (ctx, args) => {
    await requireProfilePermission(ctx, args.organizationId);
    return await ctx.storage.generateUploadUrl();
  },
});

export const updateProfileImage = mutation({
  args: {
    organizationId: v.id("organizations"),
    profileImageStorageId: v.id("_storage"),
  },
  handler: async (ctx, args) => {
    await requireProfilePermission(ctx, args.organizationId);

    const metadata = await ctx.db.system.get(
      "_storage",
      args.profileImageStorageId,
    );
    if (!metadata) {
      throw new Error("Uploaded image was not found");
    }

    const validationMessage = validateOrganizationProfileImageDetails({
      type: metadata.contentType,
      size: metadata.size,
    });
    if (validationMessage) {
      throw new Error(validationMessage);
    }

    await ctx.db.patch(args.organizationId, {
      profileImageStorageId: args.profileImageStorageId,
      updatedAt: Date.now(),
    });

    return { organizationId: args.organizationId };
  },
});

export const updateProfile = action({
  args: {
    organizationId: v.id("organizations"),
    name: v.string(),
  },
  handler: async (ctx, args): Promise<{ organizationId: Id<"organizations"> }> => {
    const name = args.name.trim();
    if (name.length < 2) {
      throw new Error("Organization name must be at least 2 characters");
    }

    const identity = await requireIdentity(ctx);
    const authorization: { organization: Doc<"organizations"> } =
      await ctx.runQuery(internal.organizations.requireProfilePermissionForAction, {
        tokenIdentifier: identity.tokenIdentifier,
        organizationId: args.organizationId,
      });

    const workosOrganization = await updateWorkosOrganization({
      organizationId: authorization.organization.workosOrganizationId,
      name,
    });

    await ctx.runMutation(internal.organizations.updateProfileMirror, {
      organizationId: args.organizationId,
      name: workosOrganization.name,
      slug: slugifyOrganizationName(workosOrganization.name),
    });

    return { organizationId: args.organizationId };
  },
});

export const archiveOrganization = mutation({
  args: {
    organizationId: v.id("organizations"),
    confirmationName: v.string(),
  },
  handler: async (ctx, args) => {
    const { organization } = await requireProfilePermission(
      ctx,
      args.organizationId,
    );
    if (args.confirmationName.trim() !== organization.name) {
      throw new Error("Type the organization name to archive it");
    }

    await ctx.db.patch(args.organizationId, {
      status: "archived",
      updatedAt: Date.now(),
    });

    return { organizationId: args.organizationId };
  },
});
```

Also import `mutation` and `updateWorkosOrganization`:

```ts
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
```

```ts
import {
  createWorkosOrganization,
  createWorkosOrganizationMembership,
  sendWorkosInvitation,
  updateWorkosOrganization,
  type WorkosInvitation,
  type WorkosMembership,
} from "./workosApi";
```

Remove `isOrganizationProfileImageType` from imports if it is unused after implementation.

- [ ] **Step 6: Add internal profile authorization and mirror mutation**

Add these internal functions to `convex/organizations.ts` after `requireInvitePermission`:

```ts
export const requireProfilePermissionForAction = internalQuery({
  args: {
    tokenIdentifier: v.string(),
    organizationId: v.id("organizations"),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_tokenIdentifier", (q) =>
        q.eq("tokenIdentifier", args.tokenIdentifier),
      )
      .unique();
    if (!user) {
      throw new Error("Not authenticated");
    }

    const membership = await getActiveMembershipForOrganization(
      ctx,
      args.organizationId,
      user._id,
    );
    if (!membership || !canManageOrganizationProfile(membership.role)) {
      throw new Error("Unauthorized");
    }

    const organization = await ctx.db.get(args.organizationId);
    if (!organization || organization.status !== "active") {
      throw new Error("Organization not found");
    }

    return { organization, membership, user };
  },
});

export const updateProfileMirror = internalMutation({
  args: {
    organizationId: v.id("organizations"),
    name: v.string(),
    slug: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.organizationId, {
      name: args.name,
      slug: args.slug,
      updatedAt: Date.now(),
    });

    return args.organizationId;
  },
});
```

- [ ] **Step 7: Run Convex source tests to verify they pass**

Run:

```bash
pnpm exec vitest run convex/organizations.test.ts
```

Expected: PASS.

- [ ] **Step 8: Run type generation if Convex API refs are stale**

Run:

```bash
pnpm exec convex codegen
```

Expected: generated files update `api.organizations.generateProfileImageUploadUrl`, `api.organizations.updateProfileImage`, `api.organizations.updateProfile`, and `api.organizations.archiveOrganization`.

- [ ] **Step 9: Commit Convex backend changes**

Run:

```bash
git add convex/schema.ts convex/organizations.ts convex/organizations.test.ts convex/validators.ts convex/_generated
git commit -m "Add organization profile backend"
```

## Task 4: Organizer Profile Route And Workspace Wiring

**Files:**
- Modify: `app/components/organizer-workspace/types.ts`
- Modify: `app/components/organizer-workspace/admin-sidebar.tsx`
- Create: `app/admin/organization/page.tsx`
- Modify: `app/components/organizer-workspace.tsx`
- Modify: `app/components/organizer-workspace.test.ts`

- [ ] **Step 1: Write failing workspace wiring tests**

In `app/components/organizer-workspace.test.ts`, add:

```ts
const organizationProfilePageSource = readFileSync(
  new URL("../admin/organization/page.tsx", import.meta.url),
  "utf8",
);
const organizationProfileSource = readFileSync(
  new URL("./organizer-workspace/organization-profile-view.tsx", import.meta.url),
  "utf8",
);
```

Add this test:

```ts
test("Organizer workspace exposes an organization profile route", () => {
  assert.match(typesSource, /export type AdminView = "tournaments" \| "staff" \| "organization"/);
  assert.match(sidebarSource, /href="\/admin\/organization"/);
  assert.match(sidebarSource, /isActive={view === "organization"}/);
  assert.match(sidebarSource, /<Building2 \/>/);
  assert.match(organizationProfilePageSource, /<OrganizerWorkspace view="organization" \/>/);
  assert.match(workspaceSource, /from "\.\/organizer-workspace\/organization-profile-view"/);
  assert.match(workspaceSource, /<OrganizationProfileView[\s>]/);
});
```

Add `organizationProfileSource` to the `combinedSource` array in the stale-copy test.

- [ ] **Step 2: Run workspace tests to verify they fail**

Run:

```bash
pnpm exec vitest run app/components/organizer-workspace.test.ts
```

Expected: FAIL because the route and profile module do not exist.

- [ ] **Step 3: Update view types**

Change `AdminView` in `app/components/organizer-workspace/types.ts`:

```ts
export type AdminView = "tournaments" | "staff" | "organization";
export type BusyState =
  | "org"
  | "invite"
  | "tournament"
  | "profile"
  | "profileImage"
  | "archive"
  | null;
```

Add this type:

```ts
export type OrganizationWithProfileImage = Doc<"organizations"> & {
  profileImageUrl: string | null;
};
```

Change `OrganizationRow`:

```ts
export type OrganizationRow = {
  organization: OrganizationWithProfileImage;
  membership: Doc<"organizationMemberships">;
};
```

- [ ] **Step 4: Add the sidebar link**

In `app/components/organizer-workspace/admin-sidebar.tsx`, add this `SidebarMenuItem` after Staff:

```tsx
<SidebarMenuItem>
  <SidebarMenuButton
    asChild
    isActive={view === "organization"}
    tooltip="Organization"
  >
    <Link href="/admin/organization">
      <Building2 />
      <span>Organization</span>
    </Link>
  </SidebarMenuButton>
</SidebarMenuItem>
```

- [ ] **Step 5: Add the route file**

Create `app/admin/organization/page.tsx` by copying the authenticated route shape from `app/admin/staff/page.tsx` and changing:

```tsx
export default function AdminOrganizationPage() {
  return (
    <main className="min-h-svh bg-stone-100 text-stone-950">
      <AuthLoading>
        <div className="flex min-h-svh items-center justify-center">
          <div className="size-8 animate-spin rounded-full border-2 border-emerald-700 border-t-transparent" />
        </div>
      </AuthLoading>
      <Unauthenticated>
        <SignedOutAdmin />
      </Unauthenticated>
      <Authenticated>
        <OrganizerWorkspace view="organization" />
      </Authenticated>
    </main>
  );
}
```

Use this signed-out body copy in the same file:

```tsx
<p className="mt-5 text-base leading-7 text-stone-300">
  Organization profile, staff membership, and tournament operations live in the
  admin workspace.
</p>
```

- [ ] **Step 6: Wire profile view placeholder in OrganizerWorkspace**

Import the profile view:

```ts
import { OrganizationProfileView } from "./organizer-workspace/organization-profile-view";
```

For this task, create a minimal placeholder file at `app/components/organizer-workspace/organization-profile-view.tsx`:

```tsx
export function OrganizationProfileView() {
  return <section>Organization profile</section>;
}
```

In `OrganizerWorkspace`, replace the current ternary body with a three-way branch:

```tsx
{view === "staff" ? (
  <StaffView
    activeMembership={activeMembership}
    busy={busy}
    inviteEmail={inviteEmail}
    invitations={invitations}
    inviteRole={inviteRole}
    mayInvite={mayInvite}
    members={members}
    onInvite={handleInvite}
    onInviteEmailChange={setInviteEmail}
    onInviteRoleChange={setInviteRole}
  />
) : view === "organization" ? (
  <OrganizationProfileView />
) : (
  <TournamentAdminView
    busy={busy}
    createTournamentOpen={createTournamentOpen}
    onAddTournamentPhase={handleAddTournamentPhase}
    onCreateTournament={handleCreateTournament}
    onCreateTournamentOpenChange={setCreateTournamentOpen}
    onRemoveTournamentPhase={handleRemoveTournamentPhase}
    onTournamentNameChange={setTournamentName}
    onTournamentIsTestEventChange={setTournamentIsTestEvent}
    onTournamentPhasesChange={setTournamentPhases}
    onTournamentPlayerCapacityChange={setTournamentPlayerCapacity}
    onTournamentStartDateTimeChange={setTournamentStartDateTime}
    selectedOrganizationId={selectedOrganizationId}
    selectedOrganizationName={details?.organization.name}
    tournamentName={tournamentName}
    tournamentIsTestEvent={tournamentIsTestEvent}
    tournamentPhases={tournamentPhases}
    tournamentPlayerCapacity={tournamentPlayerCapacity}
    tournamentStartDateTime={tournamentStartDateTime}
    tournaments={tournaments}
  />
)}
```

- [ ] **Step 7: Run workspace tests to verify they pass**

Run:

```bash
pnpm exec vitest run app/components/organizer-workspace.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit route wiring**

Run:

```bash
git add app/admin/organization/page.tsx app/components/organizer-workspace.tsx app/components/organizer-workspace.test.ts app/components/organizer-workspace/admin-sidebar.tsx app/components/organizer-workspace/types.ts app/components/organizer-workspace/organization-profile-view.tsx
git commit -m "Add organization profile route"
```

## Task 5: Organization Profile UI And Client Handlers

**Files:**
- Modify: `app/components/organizer-workspace.tsx`
- Modify: `app/components/organizer-workspace/organization-profile-view.tsx`
- Modify: `app/components/organizer-workspace.test.ts`

- [ ] **Step 1: Write failing UI source tests**

Add this test to `app/components/organizer-workspace.test.ts`:

```ts
test("Organization profile view owns profile forms and archive confirmation", () => {
  assert.match(organizationProfileSource, /from "@\/components\/ui\/card"/);
  assert.match(organizationProfileSource, /from "@\/components\/ui\/field"/);
  assert.match(organizationProfileSource, /from "@\/components\/ui\/input"/);
  assert.match(organizationProfileSource, /from "@\/components\/ui\/button"/);
  assert.match(organizationProfileSource, /Organization profile/);
  assert.match(organizationProfileSource, /Profile picture/);
  assert.match(organizationProfileSource, /Archive organization/);
  assert.match(organizationProfileSource, /Only owners and admins/);
  assert.match(workspaceSource, /api\.organizations\.generateProfileImageUploadUrl/);
  assert.match(workspaceSource, /api\.organizations\.updateProfileImage/);
  assert.match(workspaceSource, /api\.organizations\.updateProfile/);
  assert.match(workspaceSource, /api\.organizations\.archiveOrganization/);
  assert.match(workspaceSource, /validateOrganizationProfileImageDetails/);
});
```

- [ ] **Step 2: Run UI source tests to verify they fail**

Run:

```bash
pnpm exec vitest run app/components/organizer-workspace.test.ts
```

Expected: FAIL because the profile UI and handlers are placeholders.

- [ ] **Step 3: Add client state and mutations to OrganizerWorkspace**

Add imports:

```ts
import {
  validateOrganizationProfileImageDetails,
  type OrganizationProfileImageDetails,
} from "@/lib/organization-profile-image";
import { canManageOrganizationProfile } from "@/lib/organizer-utils";
```

Add hooks:

```ts
const generateProfileImageUploadUrl = useMutation(
  api.organizations.generateProfileImageUploadUrl,
);
const updateProfileImage = useMutation(api.organizations.updateProfileImage);
const updateProfile = useAction(api.organizations.updateProfile);
const archiveOrganization = useMutation(api.organizations.archiveOrganization);
```

Add state:

```ts
const [profileName, setProfileName] = useState("");
const [archiveConfirmationName, setArchiveConfirmationName] = useState("");
```

Add an effect after `activeMembership`:

```ts
useEffect(() => {
  if (details?.organization.name) {
    setProfileName(details.organization.name);
    setArchiveConfirmationName("");
  }
}, [details?.organization._id, details?.organization.name]);
```

Add permission:

```ts
const mayManageProfile = activeMembership
  ? canManageOrganizationProfile(activeMembership.role)
  : false;
```

- [ ] **Step 4: Add profile submit handlers**

Add these functions inside `OrganizerWorkspace`:

```ts
async function handleUpdateProfile(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  if (!selectedOrganizationId) {
    return;
  }

  setBusy("profile");
  setNotice(null);
  try {
    await updateProfile({
      organizationId: selectedOrganizationId,
      name: profileName,
    });
    setNotice("Organization profile updated.");
  } catch (error) {
    setNotice(
      error instanceof Error
        ? error.message
        : "Could not update organization profile.",
    );
  } finally {
    setBusy(null);
  }
}

async function handleUpdateProfileImage(file: File) {
  if (!selectedOrganizationId) {
    return;
  }

  setBusy("profileImage");
  setNotice(null);
  try {
    const dimensions = await readImageDimensions(file);
    const validationMessage = validateOrganizationProfileImageDetails({
      type: file.type,
      size: file.size,
      ...dimensions,
    });
    if (validationMessage) {
      throw new Error(validationMessage);
    }

    const uploadUrl = await generateProfileImageUploadUrl({
      organizationId: selectedOrganizationId,
    });
    const response = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!response.ok) {
      throw new Error("Could not upload profile picture.");
    }

    const { storageId } = (await response.json()) as { storageId: Id<"_storage"> };
    await updateProfileImage({
      organizationId: selectedOrganizationId,
      profileImageStorageId: storageId,
    });
    setNotice("Organization profile picture updated.");
  } catch (error) {
    setNotice(
      error instanceof Error
        ? error.message
        : "Could not update organization profile picture.",
    );
  } finally {
    setBusy(null);
  }
}

async function handleArchiveOrganization(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  if (!selectedOrganizationId) {
    return;
  }

  setBusy("archive");
  setNotice(null);
  try {
    await archiveOrganization({
      organizationId: selectedOrganizationId,
      confirmationName: archiveConfirmationName,
    });
    window.localStorage.removeItem(SELECTED_ORGANIZATION_STORAGE_KEY);
    setExplicitOrganizationId(null);
    setArchiveConfirmationName("");
    setNotice("Organization archived.");
  } catch (error) {
    setNotice(
      error instanceof Error ? error.message : "Could not archive organization.",
    );
  } finally {
    setBusy(null);
  }
}
```

Add this helper outside the component:

```ts
function readImageDimensions(file: File) {
  return new Promise<Pick<OrganizationProfileImageDetails, "width" | "height">>(
    (resolve, reject) => {
      const image = new Image();
      const objectUrl = URL.createObjectURL(file);

      image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve({ width: image.naturalWidth, height: image.naturalHeight });
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Could not read profile picture dimensions."));
      };
      image.src = objectUrl;
    },
  );
}
```

- [ ] **Step 5: Pass profile props**

Replace the placeholder profile branch with:

```tsx
<OrganizationProfileView
  archiveConfirmationName={archiveConfirmationName}
  busy={busy}
  mayManageProfile={mayManageProfile}
  membershipRole={activeMembership?.role ?? null}
  onArchiveConfirmationNameChange={setArchiveConfirmationName}
  onArchiveOrganization={handleArchiveOrganization}
  onProfileImageChange={(file) => void handleUpdateProfileImage(file)}
  onProfileNameChange={setProfileName}
  onUpdateProfile={handleUpdateProfile}
  organization={details?.organization ?? null}
  profileName={profileName}
/>
```

- [ ] **Step 6: Implement OrganizationProfileView UI**

Replace `app/components/organizer-workspace/organization-profile-view.tsx` with:

```tsx
import type { FormEvent } from "react";
import { Archive, Building2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import type {
  BusyState,
  MemberRole,
  OrganizationWithProfileImage,
} from "./types";

export function OrganizationProfileView({
  archiveConfirmationName,
  busy,
  mayManageProfile,
  membershipRole,
  onArchiveConfirmationNameChange,
  onArchiveOrganization,
  onProfileImageChange,
  onProfileNameChange,
  onUpdateProfile,
  organization,
  profileName,
}: {
  archiveConfirmationName: string;
  busy: BusyState;
  mayManageProfile: boolean;
  membershipRole: MemberRole | null;
  onArchiveConfirmationNameChange: (value: string) => void;
  onArchiveOrganization: (event: FormEvent<HTMLFormElement>) => void;
  onProfileImageChange: (file: File) => void;
  onProfileNameChange: (value: string) => void;
  onUpdateProfile: (event: FormEvent<HTMLFormElement>) => void;
  organization: OrganizationWithProfileImage | null;
  profileName: string;
}) {
  if (!organization) {
    return <Skeleton className="h-72" />;
  }

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {membershipRole ?? "No org"}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal">
            Organization profile
          </h1>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
            <CardDescription>
              Update the selected organization workspace profile.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onUpdateProfile}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="profile-organization-name">
                    Name
                  </FieldLabel>
                  <Input
                    id="profile-organization-name"
                    value={profileName}
                    onChange={(event) => onProfileNameChange(event.target.value)}
                    disabled={!mayManageProfile || busy === "profile"}
                    required
                  />
                </Field>
                <Button
                  type="submit"
                  disabled={!mayManageProfile || busy === "profile"}
                >
                  {busy === "profile" ? (
                    <Spinner data-icon="inline-start" />
                  ) : null}
                  Save changes
                </Button>
                {!mayManageProfile && (
                  <FieldDescription>
                    Only owners and admins can update organization details.
                  </FieldDescription>
                )}
              </FieldGroup>
            </form>
          </CardContent>
        </Card>

        <aside className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Profile picture</CardTitle>
              <CardDescription>PNG, JPEG, or WebP up to 2 MB.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex size-28 items-center justify-center overflow-hidden rounded-md border border-border bg-muted">
                {organization.profileImageUrl ? (
                  <img
                    src={organization.profileImageUrl}
                    alt=""
                    className="size-full object-cover"
                  />
                ) : (
                  <Building2 className="text-muted-foreground" />
                )}
              </div>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="profile-image">Upload image</FieldLabel>
                  <Input
                    id="profile-image"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={!mayManageProfile || busy === "profileImage"}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) {
                        onProfileImageChange(file);
                      }
                      event.target.value = "";
                    }}
                  />
                  <FieldDescription>
                    Use a square image at least 256 x 256 pixels.
                  </FieldDescription>
                </Field>
                {busy === "profileImage" && (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Spinner data-icon="inline-start" />
                    Uploading profile picture
                  </p>
                )}
              </FieldGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Archive organization</CardTitle>
              <CardDescription>
                Archive hides this workspace without deleting historical data.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={onArchiveOrganization}>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="archive-confirmation">
                      Type {organization.name}
                    </FieldLabel>
                    <Input
                      id="archive-confirmation"
                      value={archiveConfirmationName}
                      onChange={(event) =>
                        onArchiveConfirmationNameChange(event.target.value)
                      }
                      disabled={!mayManageProfile || busy === "archive"}
                    />
                  </Field>
                  <Button
                    type="submit"
                    variant="destructive"
                    disabled={!mayManageProfile || busy === "archive"}
                  >
                    {busy === "archive" ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <Archive data-icon="inline-start" />
                    )}
                    Archive organization
                  </Button>
                </FieldGroup>
              </form>
            </CardContent>
          </Card>
        </aside>
      </div>
    </section>
  );
}
```

- [ ] **Step 7: Run UI source tests to verify they pass**

Run:

```bash
pnpm exec vitest run app/components/organizer-workspace.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit profile UI changes**

Run:

```bash
git add app/components/organizer-workspace.tsx app/components/organizer-workspace/organization-profile-view.tsx app/components/organizer-workspace.test.ts
git commit -m "Build organization profile view"
```

## Task 6: Final Verification

**Files:**
- Review all files changed in Tasks 1-5.

- [ ] **Step 1: Run targeted tests**

Run:

```bash
pnpm exec vitest run lib/organizer-utils.test.ts lib/organization-profile-image.test.ts convex/workosApi.test.ts convex/organizations.test.ts app/components/organizer-workspace.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run lint**

Run:

```bash
pnpm run lint
```

Expected: PASS with no lint errors.

- [ ] **Step 3: Run production build**

Run:

```bash
pnpm run build
```

Expected: PASS. If Convex generated API files are stale, run `pnpm exec convex codegen`, commit generated changes, and rerun the build.

- [ ] **Step 4: Browser check**

Run the app:

```bash
pnpm run dev:frontend
```

Open `/admin/organization` in the in-app browser. Verify the route loads, sidebar highlights Organization, staff users see read-only controls, owner/admin users can see enabled controls, and the profile picture input communicates the 2 MB and 256 x 256 pixel constraints.

- [ ] **Step 5: Commit any final fixes**

Run:

```bash
git status --short
git add app/admin/organization/page.tsx app/components/organizer-workspace.tsx app/components/organizer-workspace.test.ts app/components/organizer-workspace/admin-sidebar.tsx app/components/organizer-workspace/organization-profile-view.tsx app/components/organizer-workspace/types.ts convex/_generated convex/organizations.ts convex/organizations.test.ts convex/schema.ts convex/validators.ts convex/workosApi.ts convex/workosApi.test.ts lib/organization-profile-image.ts lib/organization-profile-image.test.ts lib/organizer-utils.ts lib/organizer-utils.test.ts
git commit -m "Verify organization profile page"
```

Only commit if final verification required additional code or generated-file fixes.

## Self-Review

- Spec coverage: The plan adds `/admin/organization`, sidebar navigation, profile name editing, Convex storage image upload with MIME/size/dimension constraints, owner/admin authorization, staff read-only behavior, WorkOS name sync, and soft archive without WorkOS delete.
- Placeholder scan: The plan contains no TBD, TODO, "implement later", or unbounded "add tests" instructions.
- Type consistency: `AdminView`, `BusyState`, `OrganizationWithProfileImage`, `profileImageStorageId`, `profileImageUrl`, and all Convex function names are consistent across backend, frontend, and tests.
