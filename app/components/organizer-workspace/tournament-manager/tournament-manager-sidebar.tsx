"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "convex/react";
import { ChevronLeft, ClipboardList, Swords, Trophy } from "lucide-react";

import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

type NavItem = {
  label: string;
  href: string;
  icon: typeof ClipboardList;
};

export function TournamentManagerSidebar({
  tournamentId,
}: {
  tournamentId: string;
}) {
  const setup = useQuery(api.tournaments.getTournamentSetup, {
    tournamentId: tournamentId as Id<"tournaments">,
  });
  const tournament = setup?.tournament;
  const pathname = usePathname();
  const base = `/admin/tournaments/${tournamentId}`;
  const items: NavItem[] = [
    {
      label: "Registrations",
      href: base,
      icon: ClipboardList,
    },
    {
      label: "Pairings",
      href: `${base}/pairings`,
      icon: Swords,
    },
    {
      label: "Standings",
      href: `${base}/standings`,
      icon: Trophy,
    },
  ];

  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-sidebar text-sidebar-foreground md:flex">
      <div className="border-b border-border p-3">
        <Link
          href="/admin"
          className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <ChevronLeft className="size-3.5" />
          All tournaments
        </Link>
        <div className="mt-3">
          {tournament ? (
            <>
              <p className="truncate text-sm font-semibold text-foreground">
                {tournament.name}
              </p>
              <p className="mt-1 text-xs capitalize text-muted-foreground">
                {tournament.status.replace(/_/g, " ")}
              </p>
            </>
          ) : (
            <div className="grid gap-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-16" />
            </div>
          )}
        </div>
      </div>

      <nav className="flex flex-col gap-px p-2">
        {items.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === item.href;
          return (
            <Link
              key={item.href}
              href={item.href}
              data-active={isActive}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-2 text-sm text-sidebar-foreground transition-colors",
                "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                "data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground",
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
