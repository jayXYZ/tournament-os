import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { UnverifiedViewerActions } from "@/components/unverified-viewer-actions";
import { palette } from "@/lib/palette";

// The viewer auth gate's `unverified` state as a whole screen (see
// ViewerAuthGate in @paper-pairings/core): Clerk has a user Convex could not
// verify. Worded once for every player screen that gates on the viewer —
// the event page and the join screen — and actioned by
// UnverifiedViewerActions (restart the handshake, or sign out).
export function UnverifiedViewerShell() {
  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <View style={styles.body}>
        <Text style={styles.title}>{"We couldn't verify your account"}</Text>
        <Text style={styles.muted}>
          {
            "You're signed in, but the server couldn't confirm your session. Try again, or sign out and sign back in."
          }
        </Text>
        <UnverifiedViewerActions style={styles.actions} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  body: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 12,
  },
  title: { color: palette.foreground, fontSize: 22, fontWeight: "700" },
  muted: { color: palette.mutedForeground, fontSize: 15 },
  actions: { marginTop: 12 },
});
