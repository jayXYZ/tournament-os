import type { Id } from "@tournament-os/backend/convex/_generated/dataModel";
import {
  formatRecord,
  useLatestStandings,
  useMyCurrentMatch,
  useRoundTimer,
} from "@tournament-os/core";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { useEffect } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function TournamentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const tournamentId = (id ?? null) as Id<"tournaments"> | null;

  const current = useMyCurrentMatch(tournamentId);
  const standings = useLatestStandings(tournamentId);

  // Update the header title once the tournament name loads. Done via
  // setOptions (not a <Stack.Screen> rendered inside the route) — rendering a
  // navigator child mid-stack corrupts react-native-screens, causing duplicate
  // screens, broken back navigation, and white seams during transitions.
  const navigation = useNavigation();
  const tournamentName = current?.tournament.name;
  useEffect(() => {
    if (tournamentName) {
      navigation.setOptions({ title: tournamentName });
    }
  }, [navigation, tournamentName]);

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionTitle}>Current round</Text>
        <RoundCountdown current={current} />
        <CurrentMatch current={current} />

        <Text style={[styles.sectionTitle, styles.sectionGap]}>Standings</Text>
        <Standings standings={standings} />
      </ScrollView>
    </SafeAreaView>
  );
}

// Live round timer, ticked locally against the Convex-synced anchors carried
// on getMyCurrentMatch. Hidden while no timer is set; overtime counts up in red.
function RoundCountdown({
  current,
}: {
  current: ReturnType<typeof useMyCurrentMatch>;
}) {
  const { phase, remainingMs, formatted } = useRoundTimer(
    current?.tournament.roundTimer,
  );
  if (phase === "idle") {
    return null;
  }

  const overtime = remainingMs < 0;
  return (
    <Text style={[styles.countdown, overtime && styles.countdownOvertime]}>
      {phase === "paused" ? "Timer paused · " : ""}
      {formatted}
    </Text>
  );
}

function CurrentMatch({
  current,
}: {
  current: ReturnType<typeof useMyCurrentMatch>;
}) {
  if (current === undefined) {
    return <Text style={styles.muted}>Loading…</Text>;
  }

  switch (current.kind) {
    case "not_started":
      return (
        <Text style={styles.muted}>The tournament hasn’t started yet.</Text>
      );
    case "player_meeting":
      if (current.myRegistrationStatus === "dropped") {
        return (
          <Text style={styles.muted}>
            You have dropped from this tournament, so you are no longer seated.
          </Text>
        );
      }
      return (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Player meeting</Text>
          <Text style={styles.cardTitle}>
            {current.meeting.tableNumber === null
              ? "See the organizer for your seat"
              : `Table ${current.meeting.tableNumber}`}
          </Text>
          <Text style={styles.muted}>
            {current.meeting.seatmateName
              ? `Seated with ${current.meeting.seatmateName}. `
              : ""}
            Take your seat and check in with the organizer. Pairings will
            appear here once the meeting wraps up.
          </Text>
        </View>
      );
    case "between_rounds":
      return (
        <Text style={styles.muted}>
          Round {current.round.roundNumber} is complete. Awaiting next round
          pairings.
        </Text>
      );
    case "pairings_pending":
      return (
        <Text style={styles.muted}>
          Round {current.round.roundNumber} pairings pending. The organizer is
          reviewing this round’s pairings. They will appear here once
          published.
        </Text>
      );
    case "no_match":
      return (
        <Text style={styles.muted}>
          No pairing yet for round {current.round.roundNumber}.
        </Text>
      );
    case "match":
      return (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>
            Round {current.round.roundNumber}
            {current.match.tableNumber != null
              ? ` · Table ${current.match.tableNumber}`
              : ""}
          </Text>
          <Text style={styles.cardTitle}>
            {current.me.isBye
              ? "You have a bye"
              : `vs ${current.opponent?.name ?? "TBD"}`}
          </Text>
          <Text style={styles.muted}>Status: {current.match.matchStatus}</Text>
        </View>
      );
  }
}

function Standings({
  standings,
}: {
  standings: ReturnType<typeof useLatestStandings>;
}) {
  if (standings === undefined) {
    return <Text style={styles.muted}>Loading…</Text>;
  }
  if (standings === null) {
    return <Text style={styles.muted}>No standings published yet.</Text>;
  }

  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>After round {standings.roundNumber}</Text>
      {standings.rows.map((row) => (
        <View
          key={`${row.rank}-${row.name ?? "anon"}`}
          style={[styles.row, row.isMe && styles.rowMe]}
        >
          <Text style={styles.rank}>{row.rank}</Text>
          <Text style={styles.name} numberOfLines={1}>
            {row.name ?? "Unknown player"}
          </Text>
          {row.playoffStatus !== "not_started" ? (
            <Text style={styles.playoffStatus}>
              {row.playoffStatus === "active"
                ? "Still active"
                : row.playoffStatus === "cut"
                  ? "Missed cut"
                  : row.eliminatedInRoundNumber === null
                    ? "Eliminated"
                    : `Eliminated R${row.eliminatedInRoundNumber}`}
            </Text>
          ) : null}
          <Text style={styles.record}>
            {formatRecord(row.matchWins, row.matchLosses, row.matchDraws)}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b0b0f" },
  content: { padding: 20, gap: 12 },
  sectionTitle: {
    color: "#8b8b96",
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  sectionGap: { marginTop: 12 },
  muted: { color: "#8b8b96", fontSize: 15 },
  card: { backgroundColor: "#16161d", borderRadius: 14, padding: 16, gap: 6 },
  cardLabel: { color: "#7c8cff", fontSize: 13, fontWeight: "600" },
  cardTitle: { color: "#fff", fontSize: 20, fontWeight: "700" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    gap: 12,
  },
  rowMe: {
    backgroundColor: "#1f2030",
    borderRadius: 8,
    paddingHorizontal: 8,
    marginHorizontal: -8,
  },
  countdown: {
    color: "#cfcfd6",
    fontSize: 17,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  countdownOvertime: { color: "#ff6b6b" },
  rank: { color: "#8b8b96", fontSize: 15, width: 28 },
  name: { color: "#fff", fontSize: 15, flex: 1 },
  playoffStatus: { color: "#8b8b96", fontSize: 12 },
  record: { color: "#cfcfd6", fontSize: 15, fontVariant: ["tabular-nums"] },
});
