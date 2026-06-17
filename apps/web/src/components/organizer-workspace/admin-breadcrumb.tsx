
import { Link } from "@tanstack/react-router";
import { useLocation } from "@tanstack/react-router";
import { useQuery } from "convex/react";

import { api } from "@tournament-os/backend/convex/_generated/api";
import type { Id } from "@tournament-os/backend/convex/_generated/dataModel";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Skeleton } from "@/components/ui/skeleton";
import type { AdminView } from "./types";

const viewLabels: Record<AdminView, string> = {
  tournaments: "Tournaments",
  staff: "Staff",
  organization: "Organization",
};

const tournamentPageLabels: Record<string, string> = {
  registrations: "Registrations",
  pairings: "Pairings",
  standings: "Standings",
};

function viewFromPathname(pathname: string): AdminView {
  if (pathname.startsWith("/admin/staff")) {
    return "staff";
  }
  if (pathname.startsWith("/admin/organization")) {
    return "organization";
  }
  return "tournaments";
}

export function AdminBreadcrumb() {
  const pathname = useLocation().pathname;
  const tournamentMatch = pathname.match(
    /^\/admin\/tournaments\/([^/]+)(?:\/([^/]+))?/,
  );

  if (tournamentMatch) {
    return (
      <TournamentBreadcrumb
        tournamentId={tournamentMatch[1]}
        segment={tournamentMatch[2]}
      />
    );
  }

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link to="/admin">Admin</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbPage>{viewLabels[viewFromPathname(pathname)]}</BreadcrumbPage>
        </BreadcrumbItem>
      </BreadcrumbList>
    </Breadcrumb>
  );
}

function TournamentBreadcrumb({
  tournamentId,
  segment,
}: {
  tournamentId: string;
  segment?: string;
}) {
  const setup = useQuery(api.tournaments.lifecycle.getTournamentSetup, {
    tournamentId: tournamentId as Id<"tournaments">,
  });
  const name = setup?.tournament.name;
  const pageLabel = segment ? tournamentPageLabels[segment] : undefined;
  const base = `/admin/tournaments/${tournamentId}`;

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link to="/admin">Admin</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link to="/admin">Tournaments</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>
        <BreadcrumbSeparator />
        <BreadcrumbItem>
          {name === undefined ? (
            <Skeleton className="h-4 w-28" />
          ) : pageLabel ? (
            <BreadcrumbLink asChild>
              <Link to={base} className="max-w-48 truncate">
                {name}
              </Link>
            </BreadcrumbLink>
          ) : (
            <BreadcrumbPage className="max-w-48 truncate">
              {name}
            </BreadcrumbPage>
          )}
        </BreadcrumbItem>
        {pageLabel && (
          <>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage>{pageLabel}</BreadcrumbPage>
            </BreadcrumbItem>
          </>
        )}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
