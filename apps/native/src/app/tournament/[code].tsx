import { useUser } from "@clerk/expo";
import {
  describeCurrentMatch,
  reportAction,
  useMyCurrentMatch,
  usePlayerTournamentAccess,
} from "@paper-pairings/core";
import type {
  CurrentMatchDescription,
  PlayerTournamentEvent,
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
import { ReportResultScoreboard } from "@/components/report-result-scoreboard";
import { SignInButton } from "@/components/sign-in-button";
import { Toast, useToast } from "@/components/toast";
import { palette } from "@/lib/palette";

// The match page: the viewer's current match — the report scoreboard while
// it is live, the result card once it lands. The Figma "Player / App bar"
// (event name + round timer) and the tab bar are still to come as custom
// chrome; until then the native stack header carries only the event name
// (see components/round-timer-pill.tsx for why the timer is not in it), and
// standings stay off this page.
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
  const { toast, show, dismiss } = useToast();

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <CurrentMatch
          current={current}
          onReported={() => show("Result reported.")}
          onReportError={(message) => show(message, "destructive")}
        />
      </ScrollView>
      <Toast toast={toast} onDismiss={dismiss} />
    </SafeAreaView>
  );
}

// Renders the shared Player View description (see @paper-pairings/core
// player-view.ts) — state branching and copy live in the presenter, this
// component owns only the native styling. While the viewer's match is
// reportable the scoreboard takes the card's place: the current round is the
// report surface, as in the web player controller's design direction. Once
// the result lands the query flips to completed and the card returns with
// the scoreline and its provenance badge.
function CurrentMatch({
  current,
  onReported,
  onReportError,
}: {
  current: ReturnType<typeof useMyCurrentMatch>;
  onReported: () => void;
  onReportError: (message: string) => void;
}) {
  const description = describeCurrentMatch(current);
  const action = reportAction(current);

  if (description.kind === "loading") {
    return <Text style={styles.muted}>Loading…</Text>;
  }

  if (action && description.kind === "card") {
    return (
      <ReportResultScoreboard
        action={action}
        label={description.label}
        title={description.title}
        onReported={onReported}
        onError={onReportError}
      />
    );
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
});
