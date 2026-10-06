import { useUser } from "@clerk/expo";
import { AuthView } from "@clerk/expo/native";
import {
  describeCurrentMatch,
  describeHeaderBadge,
  displayPlayerName,
  formatRecord,
  standingStatusLabel,
  useLatestStandings,
  useMyCurrentMatch,
  usePlayerTournamentAccess,
  useRoundTimer,
} from "@paper-pairings/core";
import type {
  CurrentMatchDescription,
  PlayerTournamentEvent,
  RoundTimer,
} from "@paper-pairings/core";
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
  const { code } = useLocalSearchParams<{ code: string }>();
  // The shared access ladder needs the app's own auth signal; Convex
  // readiness alone cannot distinguish "signed out" from "token still
  // propagating" (see @paper-pairings/core player-access.ts).
  const { user, isLoaded } = useUser();
  const access = usePlayerTournamentAccess(code ?? "", {
    user: user ?? null,
    loading: !isLoaded,
  });
  const [authOpen, setAuthOpen] = useState(false);

  // Update the header title once the event resolves. Done via setOptions
  // (not a <Stack.Screen> rendered inside the route) — rendering a navigator
  // child mid-stack corrupts react-native-screens, causing duplicate screens,
  // broken back navigation, and white seams during transitions.
  const navigation = useNavigation();
  const tournamentName =
    access.state === "loading" || access.state === "notFound"
      ? undefined
      : access.event.tournament.name;
  useEffect(() => {
    if (tournamentName) {
      navigation.setOptions({ title: tournamentName });
    }
  }, [navigation, tournamentName]);

  if (access.state === "loading") {
    return (
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <View style={styles.centered}>
          <ActivityIndicator />
        </View>
      </SafeAreaView>
    );
  }

  if (access.state === "notFound") {
    return (
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <View style={styles.content}>
          <Text style={styles.muted}>Tournament not found.</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Signed out (a deep link can land here without a session). Note Convex
  // also treats Clerk sessions with pending tasks (e.g. MFA) as signed out;
  // AuthView completes those tasks too.
  if (access.state === "signedOut") {
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

  if (access.state === "notRegistered") {
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

  return <TournamentContent event={access.event} />;
}

// Mounted only in the `ready` access state, so the player subscriptions
// exist only while the viewer holds a confirmed registration — the player
// queries reject anything less (the server's requireRegisteredPlayer).
function TournamentContent({ event }: { event: PlayerTournamentEvent }) {
  const current = useMyCurrentMatch(event.tournament._id);
  const standings = useLatestStandings(event.tournament._id);
  const badge = describeHeaderBadge(current);

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Current round</Text>
          {badge ? <Text style={styles.headerBadge}>{badge.label}</Text> : null}
        </View>
        <RoundCountdown timer={event.tournament.roundTimer} />
        <CurrentMatch current={current} />

        <Text style={[styles.sectionTitle, styles.sectionGap]}>Standings</Text>
        <Standings standings={standings} />
      </ScrollView>
    </SafeAreaView>
  );
}

// Live round timer, ticked locally against the Convex-synced anchors carried
// on the public event query — the same source web reads. Hidden while no
// timer is set; overtime counts up in red.
function RoundCountdown({ timer }: { timer: RoundTimer | null | undefined }) {
  const { phase, remainingMs, formatted } = useRoundTimer(timer);
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

// Renders the shared Player View description (see @paper-pairings/core
// player-view.ts) — state branching and copy live in the presenter, this
// component owns only the native styling. The report action is not yet
// wired on native, so a reportable match reads as informational for now.
function CurrentMatch({
  current,
}: {
  current: ReturnType<typeof useMyCurrentMatch>;
}) {
  const description = describeCurrentMatch(current);

  if (description.kind === "loading") {
    return <Text style={styles.muted}>Loading…</Text>;
  }

  if (description.kind === "status") {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>{description.title}</Text>
        <Text style={styles.muted}>{description.body}</Text>
      </View>
    );
  }

  return <DescriptionCard description={description} />;
}

function DescriptionCard({
  description,
}: {
  description: Extract<CurrentMatchDescription, { kind: "card" }>;
}) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardLabel}>{description.label}</Text>
      <Text style={styles.cardTitle}>{description.title}</Text>
      {description.subtitle ? (
        <Text style={styles.cardSubtitle}>{description.subtitle}</Text>
      ) : null}
      {description.body ? (
        <Text style={styles.muted}>{description.body}</Text>
      ) : null}
      {description.scoreline ? (
        <View style={styles.resultRow}>
          <Text style={styles.scoreline}>{description.scoreline}</Text>
          {description.badge ? (
            <Text style={styles.resultBadge}>{description.badge.label}</Text>
          ) : null}
        </View>
      ) : null}
      {description.note ? (
        <Text style={styles.muted}>{description.note}</Text>
      ) : null}
    </View>
  );
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
        const statusLabel = standingStatusLabel(row);
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
  container: { flex: 1, backgroundColor: "#171514" },
  content: { padding: 20, gap: 12 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  signedOut: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 12,
  },
  signedOutTitle: { color: "#EDE9E0", fontSize: 22, fontWeight: "700" },
  button: {
    backgroundColor: "#5b6bff",
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 12,
  },
  buttonText: { color: "#EDE9E0", fontSize: 16, fontWeight: "600" },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    color: "#B8B2A6",
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  sectionGap: { marginTop: 12 },
  headerBadge: { color: "#7c8cff", fontSize: 13, fontWeight: "600" },
  muted: { color: "#B8B2A6", fontSize: 15 },
  card: { backgroundColor: "#262321", borderRadius: 14, padding: 16, gap: 6 },
  cardLabel: { color: "#7c8cff", fontSize: 13, fontWeight: "600" },
  cardTitle: { color: "#EDE9E0", fontSize: 20, fontWeight: "700" },
  cardSubtitle: { color: "#B8B2A6", fontSize: 16 },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  scoreline: { color: "#EDE9E0", fontSize: 17, fontWeight: "600" },
  resultBadge: { color: "#B8B2A6", fontSize: 13, fontWeight: "600" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    gap: 12,
  },
  rowMe: {
    backgroundColor: "#403D39",
    borderRadius: 8,
    paddingHorizontal: 8,
    marginHorizontal: -8,
  },
  countdown: {
    color: "#D4D1CA",
    fontSize: 17,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  countdownOvertime: { color: "#ff6b6b" },
  rank: { color: "#B8B2A6", fontSize: 15, width: 28 },
  name: { color: "#EDE9E0", fontSize: 15, flex: 1 },
  playoffStatus: { color: "#B8B2A6", fontSize: 12 },
  record: { color: "#D4D1CA", fontSize: 15, fontVariant: ["tabular-nums"] },
});
