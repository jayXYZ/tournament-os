import { RegistrationsView } from "@/app/components/organizer-workspace/tournament-manager/registrations-view";

export default async function TournamentRegistrationsPage({
  params,
}: {
  params: Promise<{ tournamentId: string }>;
}) {
  const { tournamentId } = await params;

  return <RegistrationsView tournamentId={tournamentId} />;
}
