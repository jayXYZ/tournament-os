import { useUser } from "@clerk/expo";
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
import { useEffect } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Badge } from "@/components/badge";
import { SignInButton } from "@/components/sign-in-button";
import { palette } from "@/lib/palette";

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
          <ActivityIndicator color={palette.mutedForeground} />
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

  // Signed out (a deep link can land here without a session).
  if (access.state === "signedOut") {
    return (
      <SafeAreaView style={styles.container} edges={["bottom"]}>
        <View style={styles.signedOut}>
          <Text style={styles.signedOutTitle}>Sign in to view this event</Text>
          <Text style={styles.muted}>
            Sign in to see your pairings and standings for this tournament.
          </Text>
          <SignInButton style={styles.signInButton} />
        </View>
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
          {badge ? <Badge tone={badge.tone}>{badge.label}</Badge> : null}
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
            <Badge tone={description.badge.tone}>
              {description.badge.label}
            </Badge>
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
  container: { flex: 1, backgroundColor: palette.background },
  content: { padding: 20, gap: 12 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  signedOut: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 12,
  },
  signedOutTitle: {
    color: palette.foreground,
    fontSize: 22,
    fontWeight: "700",
  },
  signInButton: { marginTop: 12 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  sectionTitle: {
    color: palette.mutedForeground,
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  sectionGap: { marginTop: 12 },
  muted: { color: palette.mutedForeground, fontSize: 15 },
  card: {
    backgroundColor: palette.card,
    borderRadius: 14,
    padding: 16,
    gap: 6,
  },
  // The card eyebrow; web renders it as CardDescription (muted text).
  cardLabel: {
    color: palette.mutedForeground,
    fontSize: 13,
    fontWeight: "600",
  },
  cardTitle: { color: palette.foreground, fontSize: 20, fontWeight: "700" },
  cardSubtitle: { color: palette.mutedForeground, fontSize: 16 },
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  scoreline: { color: palette.foreground, fontSize: 17, fontWeight: "600" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    gap: 12,
  },
  rowMe: {
    backgroundColor: palette.secondary,
    borderRadius: 8,
    paddingHorizontal: 8,
    marginHorizontal: -8,
  },
  countdown: {
    color: palette.foreground,
    fontSize: 17,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  countdownOvertime: { color: palette.destructive },
  rank: { color: palette.mutedForeground, fontSize: 15, width: 28 },
  name: { color: palette.foreground, fontSize: 15, flex: 1 },
  playoffStatus: { color: palette.mutedForeground, fontSize: 12 },
  record: {
    color: palette.foreground,
    fontSize: 15,
    fontVariant: ["tabular-nums"],
  },
});
