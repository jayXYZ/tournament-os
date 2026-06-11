import { TournamentPublicPage } from "@/app/components/tournament-public-page";

export default async function PublicTournamentPage({
  params,
}: {
  params: Promise<{ tournamentId: string }>;
}) {
  const { tournamentId } = await params;

  return <TournamentPublicPage tournamentId={tournamentId} />;
}
