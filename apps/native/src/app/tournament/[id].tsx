import { AuthView } from "@clerk/expo/native";
import type { Id } from "@tournament-os/backend/convex/_generated/dataModel";
import {
  displayPlayerName,
  formatRecord,
  standingStatusLabel,
  useConvexAuthReadiness,
  useLatestStandings,
  useMyCurrentMatch,
  useMyRegistration,
  useRoundTimer,
} from "@tournament-os/core";
import { useLocalSearchParams, useNavigation } from "expo-router";
import { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

export default function TournamentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const tournamentId = (id ?? null) as Id<"tournaments"> | null;

  const auth = useConvexAuthReadiness();
  const [authOpen, setAuthOpen] = useState(false);

  // The player queries reject entries that are not confirmed (e.g. a
  // registration cancelled while this screen is open), so gate them on
  // entryStatus to match the server's requireRegisteredPlayer.
  const registration = useMyRegistration(tournamentId);
  const confirmedTournamentId =
    registration?.entryStatus === "confirmed" ? tournamentId : null;
  const current = useMyCurrentMatch(confirmedTournamentId);
  const standings = useLatestStandings(confirmedTournamentId);

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

  if (!tournamentId) {
    return (
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <View style={styles.content}>
          <Text style={styles.muted}>Tournament not found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Auth still resolving, or the registration query in flight.
  if (auth === "pending" || (auth === "ready" && registration === undefined)) {
    return (
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <View style={styles.centered}>
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  // Signed out (a deep link can land here without a session). Note Convex
  // also treats Clerk sessions with pending tasks (e.g. MFA) as signed out;
  // AuthView completes those tasks too.
  if (auth !== "ready") {
    return (
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <View style={styles.signedOut}>
          <Text style={styles.signedOutTitle}>Sign in to view this event</Text>
          <Text style={styles.muted}>
            Sign in to see your pairings and standings for this tournament.
          </Text>
          <Pressable style={styles.button} onPress={() => setAuthOpen(true)}>
            <Text style={styles.buttonText}>Sign in</Text>
          </Pressable>
        </View>

        <Modal
          visible={authOpen}
          presentationStyle="pageSheet"
          animationType="slide"
          onRequestClose={() => setAuthOpen(false)}
        >
          <AuthView onDismiss={() => setAuthOpen(false)} />
        </Modal>
      </SafeAreaView>
    );
  }

  // Signed in and the query resolved: null (no registration row) or a row
  // whose entry isn't confirmed both mean no seat at this event.
  if (registration?.entryStatus !== "confirmed") {
    return (
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <View style={styles.content}>
          <Text style={styles.muted}>
            You are not registered for this tournament.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

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
            Take your seat and check in with the organizer. Pairings will appear
            here once the meeting wraps up.
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
          reviewing this round’s pairings. They will appear here once published.
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
      {standings.rows.map((row) => {
        // Players see a DQ as a plain drop; the organizer view names it.
        const statusLabel = standingStatusLabel(row, {
          disqualifiedLabel: "Dropped",
        });
        return (
          <View
            key={`${row.rank}-${row.name ?? "anon"}`}
            style={[styles.row, row.isMe && styles.rowMe]}
          >
            <Text style={styles.rank}>{row.rank}</Text>
            <Text style={styles.name} numberOfLines={1}>
              {displayPlayerName(row.name)}
            </Text>
            {statusLabel ? (
              <Text style={styles.playoffStatus}>{statusLabel}</Text>
            ) : null}
            <Text style={styles.record}>
              {formatRecord(row.matchWins, row.matchLosses, row.matchDraws)}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b0b0f" },
  content: { padding: 20, gap: 12 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  signedOut: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 12,
  },
  signedOutTitle: { color: "#fff", fontSize: 22, fontWeight: "700" },
  button: {
    backgroundColor: "#5b6bff",
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 12,
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
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
