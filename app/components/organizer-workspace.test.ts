import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspaceSource = readFileSync(
  new URL("./organizer-workspace.tsx", import.meta.url),
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

test("OrganizerWorkspace keeps a narrow client orchestration boundary", () => {
  assert.match(workspaceSource, /^"use client";/);
  assert.doesNotMatch(sidebarSource, /^"use client";/);
  assert.doesNotMatch(tournamentSource, /^"use client";/);
  assert.doesNotMatch(createTournamentDialogSource, /^"use client";/);
  assert.doesNotMatch(tournamentTableSource, /^"use client";/);
  assert.doesNotMatch(staffSource, /^"use client";/);

  assert.match(workspaceSource, /from "@\/components\/ui\/sidebar"/);
  assert.match(workspaceSource, /from "@\/components\/ui\/tooltip"/);
  assert.match(workspaceSource, /from "\.\/organizer-workspace\/admin-sidebar"/);
  assert.match(workspaceSource, /from "\.\/organizer-workspace\/staff-view"/);
  assert.match(
    workspaceSource,
    /from "\.\/organizer-workspace\/tournament-admin-view"/,
  );
  assert.match(workspaceSource, /from "\.\/organizer-workspace\/types"/);

  assert.match(workspaceSource, /<TooltipProvider[\s>]/);
  assert.match(workspaceSource, /<SidebarProvider[\s>]/);
  assert.match(workspaceSource, /<SidebarInset[\s>]/);
  assert.match(workspaceSource, /<AdminSidebar[\s>]/);
  assert.match(workspaceSource, /<AdminHeader[\s>]/);
  assert.match(workspaceSource, /<StaffView[\s>]/);
  assert.match(workspaceSource, /<TournamentAdminView[\s>]/);

  assert.doesNotMatch(workspaceSource, /<Dialog[\s>]/);
  assert.doesNotMatch(workspaceSource, /<Table[\s>]/);
  assert.doesNotMatch(workspaceSource, /function TournamentRow/);
  assert.doesNotMatch(workspaceSource, /function StaffView/);
});

test("Organizer workspace feature modules own their UI primitives", () => {
  assert.match(sidebarSource, /from "@\/components\/ui\/sidebar"/);
  assert.match(sidebarSource, /from "@\/components\/ui\/dropdown-menu"/);
  assert.match(sidebarSource, /<Sidebar[\s>]/);
  assert.match(sidebarSource, /<DropdownMenu[\s>]/);

  assert.match(tournamentSource, /from "\.\/create-tournament-dialog"/);
  assert.match(tournamentSource, /from "\.\/tournament-table"/);
  assert.match(tournamentSource, /<CreateTournamentDialog[\s>]/);
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

test("Organizer workspace avoids legacy raw controls and stale copy", () => {
  const combinedSource = [
    workspaceSource,
    sidebarSource,
    tournamentSource,
    createTournamentDialogSource,
    tournamentTableSource,
    staffSource,
    typesSource,
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
