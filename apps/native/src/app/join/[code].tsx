import { useUser } from "@clerk/expo";
import { useJoinCode, usePlayerTournamentAccess } from "@paper-pairings/core";
import type { AppAuthSnapshot, PlayerRegistration } from "@paper-pairings/core";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { JoinEventView } from "@/components/join-event-view";
import { palette } from "@/lib/palette";

// /join/<code>: where a scanned Join QR, a shared join link, or a typed code
// lands (CONTEXT.md "Join QR"). The path matches the web's, so universal
// links can route here later without a rewrite. The code is either kind —
// an event's Public Code or a private event's Invite Link code — and the
// server tells them apart; this screen never says which kind a bad code was.
export default function JoinScreen() {
  const { code } = useLocalSearchParams<{ code: string }>();
  const { user, isLoaded } = useUser();
  const appAuth: AppAuthSnapshot = { user: user ?? null, loading: !isLoaded };
  const resolution = useJoinCode(code ?? "", appAuth);

  if (resolution.state === "loading") {
    return <Loading />;
  }
  if (resolution.state === "notFound") {
    return <CodeNotFound />;
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
    case "loading":
      // Once the event is known, the summary shows while the viewer's
      // registration loads.
      return access.event === null ? <Loading /> : view(true, undefined);
    case "signedOut":
      return view(false, null);
    case "notRegistered":
    case "ready":
      return view(true, access.registration);
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

// One message for every code that opens nothing (unknown, mistyped,
// replaced, not published yet, or an event that has since gone private), as
// the server answers them all alike.
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
