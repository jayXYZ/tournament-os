import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const shellSource = readFileSync(
  new URL(
    "./organizer-workspace/admin-workspace-shell.tsx",
    import.meta.url,
  ),
  "utf8",
);
const adminLayoutSource = readFileSync(
  new URL("../admin/layout.tsx", import.meta.url),
  "utf8",
);
const viewsLayoutSource = readFileSync(
  new URL("../admin/(views)/layout.tsx", import.meta.url),
  "utf8",
);
const adminPageSource = readFileSync(
  new URL("../admin/(views)/page.tsx", import.meta.url),
  "utf8",
);
const staffPageSource = readFileSync(
  new URL("../admin/(views)/staff/page.tsx", import.meta.url),
  "utf8",
);
const organizationProfilePageSource = readFileSync(
  new URL("../admin/(views)/organization/page.tsx", import.meta.url),
  "utf8",
);
const sidebarSource = readFileSync(
  new URL("./organizer-workspace/admin-sidebar.tsx", import.meta.url),
  "utf8",
);
const tournamentSource = readFileSync(
  new URL("./organizer-workspace/tournament-admin-view.tsx", import.meta.url),
  "utf8",
);
const createTournamentDialogSource = readFileSync(
  new URL("./organizer-workspace/create-tournament-dialog.tsx", import.meta.url),
  "utf8",
);
const tournamentTableSource = readFileSync(
  new URL("./organizer-workspace/tournament-table.tsx", import.meta.url),
  "utf8",
);
const staffSource = readFileSync(
  new URL("./organizer-workspace/staff-view.tsx", import.meta.url),
  "utf8",
);
const typesSource = readFileSync(
  new URL("./organizer-workspace/types.ts", import.meta.url),
  "utf8",
);
const organizationContextSource = readFileSync(
  new URL("./organizer-workspace/organization-context.tsx", import.meta.url),
  "utf8",
);
const noticeContextSource = readFileSync(
  new URL("./organizer-workspace/notice-context.tsx", import.meta.url),
  "utf8",
);
const organizationProfileSource = readFileSync(
  new URL("./organizer-workspace/organization-profile-view.tsx", import.meta.url),
  "utf8",
);

test("AdminWorkspaceShell is a thin chrome shell over feature modules", () => {
  assert.match(shellSource, /^"use client";/);

  assert.match(shellSource, /from "@\/components\/ui\/sidebar"/);
  assert.match(shellSource, /from "@\/components\/ui\/tooltip"/);
  assert.match(shellSource, /from "\.\/admin-auth-gate"/);
  assert.match(shellSource, /from "\.\/admin-sidebar"/);
  assert.match(shellSource, /from "\.\/organization-context"/);
  assert.match(shellSource, /from "\.\/notice-context"/);

  assert.match(shellSource, /<AdminAuthGate[\s>]/);
  assert.match(shellSource, /<TooltipProvider[\s>]/);
  assert.match(shellSource, /<OrganizationProvider[\s>]/);
  assert.match(shellSource, /<NoticeProvider[\s>]/);
  assert.match(shellSource, /<SidebarProvider defaultOpen={defaultSidebarOpen}>/);
  assert.match(shellSource, /<SidebarInset[\s>]/);
  assert.match(shellSource, /<AdminSidebar[\s>/]/);
  assert.match(shellSource, /<AdminHeader[\s>/]/);
  assert.match(shellSource, /{children}/);
});

test("Admin layout reads the sidebar cookie and mounts the shell once", () => {
  assert.match(adminLayoutSource, /from "next\/headers"/);
  assert.match(adminLayoutSource, /sidebar_state/);
  assert.match(adminLayoutSource, /<AdminWorkspaceShell[\s>]/);
  assert.match(adminLayoutSource, /defaultSidebarOpen={defaultSidebarOpen}/);
  assert.doesNotMatch(adminLayoutSource, /^"use client";/);

  assert.match(viewsLayoutSource, /<WorkspaceNotice[\s>/]/);
  assert.match(viewsLayoutSource, /{children}/);
});

test("Admin pages render feature views directly", () => {
  assert.match(adminPageSource, /<TournamentAdminView[\s>/]/);
  assert.match(staffPageSource, /<StaffView[\s>/]/);
  assert.match(organizationProfilePageSource, /<OrganizationProfileView[\s>/]/);

  // No per-page chrome or auth gates; those live in the admin layout.
  for (const source of [
    adminPageSource,
    staffPageSource,
    organizationProfilePageSource,
  ]) {
    assert.doesNotMatch(source, /AdminAuthGate/);
    assert.doesNotMatch(source, /SidebarProvider/);
    assert.doesNotMatch(source, /SignedOutAdmin/);
  }
});

test("Shell does not drill state or own feature data", () => {
  assert.doesNotMatch(shellSource, /<Dialog[\s>]/);
  assert.doesNotMatch(shellSource, /<Table[\s>]/);
  assert.doesNotMatch(shellSource, /useState/);
  assert.doesNotMatch(shellSource, /api\.organizations\./);
  assert.doesNotMatch(shellSource, /api\.tournaments\./);
  assert.doesNotMatch(shellSource, /onCreateTournament=/);
  assert.doesNotMatch(shellSource, /onInvite=/);
});

test("Feature modules are self-contained client components", () => {
  assert.match(sidebarSource, /^"use client";/);
  assert.match(tournamentSource, /^"use client";/);
  assert.match(createTournamentDialogSource, /^"use client";/);
  assert.match(staffSource, /^"use client";/);
  assert.match(organizationProfileSource, /^"use client";/);

  // The tournament table handles row navigation but still does not fetch data.
  assert.match(tournamentTableSource, /^"use client";/);
  assert.doesNotMatch(tournamentTableSource, /useQuery/);
});

test("Organization selection lives in a shared context", () => {
  assert.match(organizationContextSource, /^"use client";/);
  assert.match(organizationContextSource, /createContext/);
  assert.match(
    organizationContextSource,
    /useQuery\(\s*api\.organizations\.listMine/,
  );
  assert.match(
    organizationContextSource,
    /export function OrganizationProvider/,
  );
  assert.match(organizationContextSource, /export function useOrganization/);
  assert.match(
    organizationContextSource,
    /tournament-os:selected-organization/,
  );

  assert.match(sidebarSource, /useOrganization\(\)/);
  assert.match(tournamentSource, /useOrganization\(\)/);
  assert.match(staffSource, /useOrganization\(\)/);
  assert.match(organizationProfileSource, /useOrganization\(\)/);
});

test("Notice messaging flows through a shared context", () => {
  assert.match(noticeContextSource, /^"use client";/);
  assert.match(noticeContextSource, /export function NoticeProvider/);
  assert.match(noticeContextSource, /export function useSetNotice/);
  assert.match(noticeContextSource, /export function WorkspaceNotice/);
  assert.match(noticeContextSource, /from "lucide-react"/);

  assert.match(createTournamentDialogSource, /useSetNotice\(\)/);
  assert.match(staffSource, /useSetNotice\(\)/);
  assert.match(organizationProfileSource, /useSetNotice\(\)/);
  assert.match(sidebarSource, /useSetNotice\(\)/);
});

test("Each feature module owns its Convex data and mutations", () => {
  assert.match(sidebarSource, /api\.organizations\.createOrganizerOrganization/);

  assert.match(
    tournamentSource,
    /useQuery\(\s*api\.tournaments\.listUpcomingForOrganization/,
  );
  assert.match(
    createTournamentDialogSource,
    /api\.tournaments\.createTournamentWithPhases/,
  );
  assert.match(createTournamentDialogSource, /useMutation/);

  assert.match(staffSource, /api\.organizations\.listMembers/);
  assert.match(staffSource, /api\.organizations\.listInvitations/);
  assert.match(staffSource, /api\.organizations\.inviteMember/);

  assert.match(
    organizationProfileSource,
    /api\.organizations\.generateProfileImageUploadUrl/,
  );
  assert.match(organizationProfileSource, /api\.organizations\.updateProfileImage/);
  assert.match(organizationProfileSource, /api\.organizations\.updateProfile/);
  assert.match(organizationProfileSource, /api\.organizations\.archiveOrganization/);
  assert.match(organizationProfileSource, /validateOrganizationProfileImageDetails/);
});

test("Organizer workspace feature modules own their UI primitives", () => {
  assert.match(sidebarSource, /from "@\/components\/ui\/sidebar"/);
  assert.match(sidebarSource, /from "@\/components\/ui\/dropdown-menu"/);
  assert.match(sidebarSource, /from "@\/components\/ui\/dialog"/);
  assert.match(sidebarSource, /<Sidebar[\s>]/);
  assert.match(sidebarSource, /<Sidebar\s+collapsible="icon"[\s>]/);
  assert.match(sidebarSource, /<DropdownMenu[\s>]/);
  assert.match(sidebarSource, /<Dialog[\s>]/);

  assert.match(tournamentSource, /from "\.\/create-tournament-dialog"/);
  assert.match(tournamentSource, /from "\.\/tournament-table"/);
  assert.match(tournamentSource, /<CreateTournamentDialog[\s>/]/);
  assert.match(tournamentSource, /<TournamentTable[\s>]/);

  assert.match(createTournamentDialogSource, /from "@\/components\/ui\/dialog"/);
  assert.match(createTournamentDialogSource, /from "@\/components\/ui\/checkbox"/);
  assert.match(createTournamentDialogSource, /from "@\/components\/ui\/field"/);
  assert.match(createTournamentDialogSource, /from "@\/components\/ui\/input"/);
  assert.match(createTournamentDialogSource, /from "@\/components\/ui\/select"/);
  assert.match(createTournamentDialogSource, /<Dialog[\s>]/);
  assert.match(createTournamentDialogSource, /<DialogTrigger asChild>/);
  assert.match(createTournamentDialogSource, /Create new tournament/);
  assert.match(createTournamentDialogSource, /<Checkbox[\s>]/);
  assert.match(createTournamentDialogSource, /Mark as test event/);
  assert.match(createTournamentDialogSource, /<FieldGroup[\s>]/);
  assert.match(createTournamentDialogSource, /<Input[\s>]/);
  assert.match(createTournamentDialogSource, /<Select[\s>]/);

  assert.match(tournamentTableSource, /from "@\/components\/ui\/table"/);
  assert.match(tournamentTableSource, /from "@\/components\/ui\/badge"/);
  assert.match(tournamentTableSource, /from "@\/components\/ui\/empty"/);
  assert.match(tournamentTableSource, /from "@\/components\/ui\/skeleton"/);
  assert.match(tournamentTableSource, /<Table[\s>]/);
  assert.match(tournamentTableSource, /<Badge[\s\S]*Test/);
  assert.match(tournamentTableSource, /<Empty[\s>]/);
  assert.match(tournamentTableSource, /<Skeleton[\s/>]/);

  assert.match(staffSource, /from "@\/components\/ui\/card"/);
  assert.match(staffSource, /from "@\/components\/ui\/empty"/);
  assert.match(staffSource, /from "@\/components\/ui\/field"/);
  assert.match(staffSource, /from "@\/components\/ui\/input"/);
  assert.match(staffSource, /from "@\/components\/ui\/select"/);
  assert.match(staffSource, /<Card[\s>]/);
  assert.match(staffSource, /<Empty[\s>]/);
  assert.match(staffSource, /Invite staff/);
});

test("Admin sidebar derives the active view from the pathname", () => {
  assert.match(sidebarSource, /from "next\/navigation"/);
  assert.match(sidebarSource, /usePathname\(\)/);
  assert.match(sidebarSource, /function viewFromPathname/);
  assert.match(sidebarSource, /isActive={view === "tournaments"}/);
  assert.match(sidebarSource, /isActive={view === "staff"}/);
  assert.match(sidebarSource, /isActive={view === "organization"}/);
  assert.doesNotMatch(sidebarSource, /AdminSidebar\(\{\s*view/);
});

test("Organization switcher collapses to only its icon", () => {
  const switcherMatch = sidebarSource.match(
    /function OrganizationSwitcher[\s\S]*?function UserMenu/,
  );
  assert.ok(switcherMatch, "expected organization switcher source");

  assert.match(
    switcherMatch[0],
    /<SidebarMenuButton[\s\S]*className="group-data-\[collapsible=icon\]:justify-center"/,
  );
  assert.match(
    switcherMatch[0],
    /<span className="group-data-\[collapsible=icon\]:hidden">/,
  );
  assert.match(
    switcherMatch[0],
    /<ChevronDown className="ml-auto group-data-\[collapsible=icon\]:hidden" \/>/,
  );
});

test("Organization switcher owns create organization dialog", () => {
  const switcherMatch = sidebarSource.match(
    /function OrganizationSwitcher[\s\S]*?function UserMenu/,
  );
  assert.ok(switcherMatch, "expected organization switcher source");

  assert.match(switcherMatch[0], /<DropdownMenuSeparator \/>/);
  assert.match(switcherMatch[0], /<DropdownMenuItem[\s\S]*Create organization/);
  assert.match(switcherMatch[0], /setOpen\(true\)/);
  assert.match(switcherMatch[0], /<DialogContent/);
  assert.match(
    switcherMatch[0],
    /<DialogTitle>Create organization<\/DialogTitle>/,
  );
  assert.match(switcherMatch[0], /<form\s+onSubmit={handleCreateOrganization}/);
  assert.match(switcherMatch[0], /id="organization-name"/);
  assert.match(switcherMatch[0], /disabled={busy}/);
});

test("Organizer workspace exposes an organization profile route", () => {
  assert.match(
    typesSource,
    /export type AdminView = "tournaments" \| "staff" \| "organization"/,
  );
  assert.match(sidebarSource, /href="\/admin\/organization"/);
  assert.match(sidebarSource, /isActive={view === "organization"}/);
  assert.match(sidebarSource, /<Building2 \/>/);
  assert.match(
    organizationProfilePageSource,
    /<OrganizationProfileView \/>/,
  );
});

test("Organization profile view owns profile forms and archive confirmation", () => {
  assert.match(organizationProfileSource, /from "@\/components\/ui\/card"/);
  assert.match(organizationProfileSource, /from "@\/components\/ui\/field"/);
  assert.match(organizationProfileSource, /from "@\/components\/ui\/input"/);
  assert.match(organizationProfileSource, /from "@\/components\/ui\/button"/);
  assert.match(organizationProfileSource, /Organization profile/);
  assert.match(organizationProfileSource, /Profile picture/);
  assert.match(organizationProfileSource, /Archive organization/);
  assert.match(organizationProfileSource, /Only owners and admins/);
});

test("Organizer workspace avoids legacy raw controls and stale copy", () => {
  const combinedSource = [
    shellSource,
    sidebarSource,
    tournamentSource,
    createTournamentDialogSource,
    tournamentTableSource,
    staffSource,
    typesSource,
    organizationContextSource,
    noticeContextSource,
    organizationProfileSource,
  ].join("\n");

  const headerMatch = sidebarSource.match(/<header[\s\S]*?<\/header>/);
  assert.ok(headerMatch, "expected admin content header to remain");
  assert.doesNotMatch(headerMatch[0], /Tournament OS/);

  assert.doesNotMatch(combinedSource, /function Metric/);
  assert.doesNotMatch(combinedSource, /Upcoming events/);
  assert.doesNotMatch(combinedSource, /Current org/);
  assert.doesNotMatch(combinedSource, /<table[\s>]/);
  assert.doesNotMatch(combinedSource, /<input[\s>]/);
  assert.doesNotMatch(combinedSource, /<select[\s>]/);
  assert.doesNotMatch(combinedSource, /animate-pulse/);
});
