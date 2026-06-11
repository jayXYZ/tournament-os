import { TournamentOverviewView } from "@/app/components/organizer-workspace/tournament-manager/tournament-overview-view";

export default async function TournamentOverviewPage({
  params,
}: {
  params: Promise<{ tournamentId: string }>;
}) {
  const { tournamentId } = await params;

  return <TournamentOverviewView tournamentId={tournamentId} />;
}
