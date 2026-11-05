import { useJoinCode, usePlayerTournamentAccess } from "@paper-pairings/core";
import type { AppAuthSnapshot, PlayerRegistration } from "@paper-pairings/core";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { JoinEventView } from "@/components/join-event-view";
import { SignInButton } from "@/components/sign-in-button";
import { UnverifiedViewerShell } from "@/components/unverified-viewer-shell";
import { palette } from "@/lib/palette";
import { useAppAuth } from "@/lib/use-app-auth";

// /join/<code>: where a scanned Join QR, a shared join link, or a typed code
// lands (CONTEXT.md "Join QR"). The path matches the web's, so universal
// links can route here later without a rewrite. The code is either kind —
// an event's Public Code or a private event's Invite Link code — and the
// server tells them apart; this screen never says which kind a bad code was.
export default function JoinScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  // The app's identity signal (lib/use-app-auth.ts): a session with pending
  // tasks reads as signed out here too, so the join panel offers the
  // sign-in that completes them.
  const appAuth = useAppAuth();
  const resolution = useJoinCode(code ?? "", appAuth);

  if (resolution.state === "loading") {
    return <Loading />;
  }
  if (resolution.state === "notFound") {
    return <CodeNotFound />;
  }
  // A private event's code resolves only for a verified identity, so with
  // the gate given up the code is not known to be wrong: offer the recovery.
  if (resolution.state === "unverified") {
    return <UnverifiedViewerShell />;
  }
  // Signed out, the same null may be a private event signing in opens.
  if (resolution.state === "signInToView") {
    return <SignInToView />;
  }
  return (
    <JoinEvent
      // A new code in the same screen instance starts over.
      key={`${resolution.publicCode}:${resolution.inviteCode ?? ""}`}
      publicCode={resolution.publicCode}
      inviteCode={resolution.inviteCode}
      appAuth={appAuth}
    />
  );
}

function JoinEvent({
  publicCode,
  inviteCode,
  appAuth,
}: {
  publicCode: string;
  inviteCode?: string;
  appAuth: AppAuthSnapshot;
}) {
  const router = useRouter();
  const access = usePlayerTournamentAccess(publicCode, appAuth, inviteCode);

  // As on the event page: setOptions, never a <Stack.Screen> inside the
  // route (see tournaments/[code].tsx).
  const navigation = useNavigation();
  const eventName =
    access.state === "notFound" ? undefined : access.event?.tournament.name;
  useEffect(() => {
    if (eventName) {
      navigation.setOptions({ title: eventName });
    }
  }, [navigation, eventName]);

  // Replace, not push: back from the event page goes home, not to a join
  // screen that has nothing left to offer.
  const openEvent = () =>
    router.replace({
      pathname: "/tournaments/[code]",
      params: { code: publicCode },
    });
  const view = (
    signedIn: boolean,
    registration: PlayerRegistration | null | undefined,
  ) =>
    access.state === "notFound" || access.event === null ? null : (
      <JoinEventView
        event={access.event}
        signedIn={signedIn}
        registration={registration}
        inviteCode={inviteCode}
        onOpenEvent={openEvent}
      />
    );

  switch (access.state) {
    case "notFound":
      return <CodeNotFound />;
    case "unverified":
      return <UnverifiedViewerShell />;
    case "loading":
      // Once the event is known, the summary shows while the viewer's
      // registration loads.
      return access.event === null ? <Loading /> : view(true, undefined);
    case "signedOut":
      return view(false, null);
    case "notRegistered":
    case "ready":
      return view(true, access.registration);
    default: {
      // A new ladder state must choose a shell here, never fall through to
      // an empty screen.
      const unhandled: never = access;
      throw new Error(`Unhandled access state: ${JSON.stringify(unhandled)}`);
    }
  }
}

function Loading() {
  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <View style={styles.centered}>
        <ActivityIndicator color={palette.mutedForeground} />
      </View>
    </SafeAreaView>
  );
}

// A signed-out viewer whose code opened nothing (useJoinCode). Once signed
// in, the screen resolves the code again by itself.
function SignInToView() {
  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <View style={styles.message}>
        <Text style={styles.title}>Sign in to view this event</Text>
        <Text style={styles.muted}>
          This may be a private event. Sign in to see it, or check the code with
          the organizer.
        </Text>
        <SignInButton />
      </View>
    </SafeAreaView>
  );
}

// One message for every code that opens nothing for a signed-in viewer
// (unknown, mistyped, replaced, not published yet, or an event that has
// since gone private), as the server answers them all alike.
function CodeNotFound() {
  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <View style={styles.message}>
        <Text style={styles.title}>Code not found</Text>
        <Text style={styles.muted}>
          This code doesn’t open an event. Check it with the organizer.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  centered: { flex: 1, alignItems: "center", justifyContent: "center" },
  message: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 12,
  },
  title: { color: palette.foreground, fontSize: 22, fontWeight: "700" },
  muted: { color: palette.mutedForeground, fontSize: 15 },
});
