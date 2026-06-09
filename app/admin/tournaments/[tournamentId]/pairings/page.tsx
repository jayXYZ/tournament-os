import { PairingsView } from "@/app/components/organizer-workspace/tournament-manager/pairings-view";

export default async function TournamentPairingsPage({
  params,
}: {
  params: Promise<{ tournamentId: string }>;
}) {
  const { tournamentId } = await params;

  return <PairingsView tournamentId={tournamentId} />;
}
