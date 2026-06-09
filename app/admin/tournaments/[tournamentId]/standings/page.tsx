import { StandingsView } from "@/app/components/organizer-workspace/tournament-manager/standings-view";

export default async function TournamentStandingsPage({
  params,
}: {
  params: Promise<{ tournamentId: string }>;
}) {
  const { tournamentId } = await params;

  return <StandingsView tournamentId={tournamentId} />;
}
