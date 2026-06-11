import { PlayerController } from "@/app/components/player-controller/player-controller";

export default async function PlayPage({
  params,
}: {
  params: Promise<{ tournamentId: string }>;
}) {
  const { tournamentId } = await params;
  return <PlayerController tournamentId={tournamentId} />;
}
