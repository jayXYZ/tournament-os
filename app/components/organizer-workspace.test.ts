import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./organizer-workspace.tsx", import.meta.url),
  "utf8",
);

test("OrganizerWorkspace uses shadcn admin shell and tournaments dialog layout", () => {
  assert.match(source, /from "@\/components\/ui\/sidebar"/);
  assert.match(source, /from "@\/components\/ui\/dropdown-menu"/);
  assert.match(source, /from "@\/components\/ui\/dialog"/);
  assert.match(source, /from "@\/components\/ui\/field"/);
  assert.match(source, /from "@\/components\/ui\/input"/);
  assert.match(source, /from "@\/components\/ui\/select"/);
  assert.match(source, /from "@\/components\/ui\/table"/);
  assert.match(source, /from "@\/components\/ui\/empty"/);
  assert.match(source, /from "@\/components\/ui\/skeleton"/);
  assert.match(source, /from "@\/components\/ui\/tooltip"/);

  assert.match(source, /<TooltipProvider[\s>]/);
  assert.match(source, /<SidebarProvider[\s>]/);
  assert.match(source, /<Sidebar[\s>]/);
  assert.match(source, /<SidebarInset[\s>]/);
  assert.match(source, /<DropdownMenu[\s>]/);
  assert.match(source, /<Dialog[\s>]/);
  assert.match(source, /<DialogTrigger asChild>/);
  assert.match(source, /Create new tournament/);
  assert.match(source, /<FieldGroup[\s>]/);
  assert.match(source, /<Input[\s>]/);
  assert.match(source, /<Select[\s>]/);
  assert.match(source, /<Table[\s>]/);
  assert.match(source, /<Empty[\s>]/);
  assert.match(source, /<Skeleton[\s/>]/);

  const headerMatch = source.match(/<header[\s\S]*?<\/header>/);
  assert.ok(headerMatch, "expected admin content header to remain");
  assert.doesNotMatch(headerMatch[0], /Tournament OS/);

  assert.doesNotMatch(source, /function Metric/);
  assert.doesNotMatch(source, /Upcoming events/);
  assert.doesNotMatch(source, /Current org/);
  assert.doesNotMatch(source, /<table[\s>]/);
  assert.doesNotMatch(source, /<input[\s>]/);
  assert.doesNotMatch(source, /<select[\s>]/);
  assert.doesNotMatch(source, /animate-pulse/);
});
