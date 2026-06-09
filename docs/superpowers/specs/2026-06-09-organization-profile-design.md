# Organization Profile Design

## Goal

Add an organization profile page to the organizer workspace. Owners and admins should be able to rename the selected organization, upload or replace its profile picture, and archive the organization. Staff can view the profile but cannot make changes.

## Context

The organizer workspace already uses `/admin` for tournaments and `/admin/staff` for staff management. `OrganizerWorkspace` is the client orchestration boundary, while feature modules under `app/components/organizer-workspace/` own their UI. Organizations are mirrored in Convex after creation in WorkOS. Convex currently stores organization name, slug, creator, status, and timestamps, but no profile image.

The user chose soft delete/archive for organization deletion. This means archived organizations should disappear from active organizer workflows while preserving tournaments, memberships, invitations, and historical data in Convex.

## Recommended Route Shape

Add a third organizer workspace route:

- `/admin`: tournaments.
- `/admin/staff`: staff management.
- `/admin/organization`: organization profile.

The existing admin sidebar should include an `Organization` item. The route should reuse `OrganizerWorkspace` so organization selection, auth, notice, and shell behavior remain consistent with the existing workspace.

## Profile Page

The organization profile view should show:

- Current organization image or a generated fallback from the organization name.
- Organization name.
- Current user's role in the selected organization.
- A name form.
- A profile picture upload control.
- A danger-zone archive section.

Owners and admins can edit. Staff should see read-only content and an insufficient-permission state near the controls.

## Image Constraints

Profile pictures should be limited to images that are reasonable for avatars and logos:

- Accepted MIME types: `image/png`, `image/jpeg`, `image/webp`.
- Maximum file size: 2 MB.
- Recommended minimum resolution: 256 x 256 pixels.
- Recommended upload shape: square.

The client should validate MIME type, file size, and image dimensions before upload for immediate feedback. The backend should also validate MIME type and file size from Convex storage metadata before attaching the uploaded file to an organization, so bypassing the browser controls cannot attach an oversized or unsupported file.

The UI should crop only by object-fit display. It should not add an image editor in this version.

## Backend Design

Add optional image storage metadata to the `organizations` table:

- `profileImageStorageId?: Id<"_storage">`

Expose image URLs from organization read APIs by resolving the storage ID with `ctx.storage.getUrl()`. Return `null` when no image exists or the file is unavailable.

Add organization profile functions:

- `generateProfileImageUploadUrl`: requires an owner/admin membership and returns a Convex upload URL.
- `updateProfileImage`: requires owner/admin membership, validates stored file metadata, and patches `profileImageStorageId`.
- `updateProfile`: requires owner/admin membership, trims and validates the name, updates the Convex organization, and syncs the name to WorkOS with the Organization update API.
- `archiveOrganization`: requires owner/admin membership, verifies a confirmation name, and sets `status: "archived"`.

Do not call the WorkOS delete organization API during archive. WorkOS deletion is permanent, and the requested behavior is soft delete/archive.

## Data Flow

The profile page should use the selected organization from `api.organizations.getById`. Successful profile mutations should rely on Convex reactivity to update the sidebar, organization switcher, and profile view.

When an organization is archived:

- Its `status` changes to `"archived"`.
- Existing `listMine` behavior should stop returning it because it only includes active organizations.
- The client should clear or replace a stale selected organization ID if the archived organization disappears from the active list.
- The app should show a success notice and fall back to the next available organization, if one exists.

## Authorization And Errors

Owners and admins can update the profile and archive. Staff cannot update or archive. Backend mutations must derive the authenticated user server-side and must not accept user IDs for authorization.

Name validation should require at least 2 characters after trimming. Archive confirmation should require typing the current organization name. Errors should surface as concise notices and preserve unsaved form values when possible.

## Component Boundaries

Keep the existing narrow client boundary:

- `OrganizerWorkspace` owns state, Convex hooks, mutation handlers, and selected organization logic.
- `organization-profile-view.tsx` owns the profile page UI.
- Existing sidebar and header modules own navigation and organization switching.

Shared role helpers should stay in `lib/organizer-utils.ts` if needed.

## Testing And Verification

Follow test-first implementation:

- Add a failing Convex/source test that verifies admin/owner profile authorization helpers exist and avoid `.filter()`.
- Add tests for organization schema/profile fields and archive behavior expectations.
- Add a frontend source test that verifies the organization profile module is wired into `OrganizerWorkspace`, sidebar navigation, and `AdminView`.
- Add focused helper tests for client-side image validation if implemented as a pure helper.

Verification should include:

- Relevant Vitest tests for Convex and organizer workspace modules.
- `pnpm run lint`.
- `pnpm run build`.
- Browser inspection of `/admin/organization` after implementation.

## Non-Goals

This change does not permanently delete organizations, delete WorkOS organizations, purge tournaments, transfer ownership, edit staff roles, provide image cropping tools, or support organization-level domains.
