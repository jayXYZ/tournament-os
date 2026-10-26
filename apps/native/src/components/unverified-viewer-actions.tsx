import { useClerk } from "@clerk/expo";
import { useRestartConvexAuth } from "@paper-pairings/core";
import { Pressable, StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { palette } from "@/lib/palette";

// The actions for the access ladder's `unverified` state (see ViewerAuthGate
// in @paper-pairings/core): Clerk has a user Convex could not verify. "Try
// again" restarts the Convex handshake; "Sign out" ends the Clerk session,
// after which the signedOut branch offers sign-in. Sign-in itself is not
// offered here — the session is live, and signing in again cannot change a
// token the server refuses.
export function UnverifiedViewerActions({
  style,
}: {
  style?: StyleProp<ViewStyle>;
}) {
  const restart = useRestartConvexAuth();
  const { signOut } = useClerk();

  return (
    <View style={[styles.row, style]}>
      <Pressable
        style={({ pressed }) => [
          styles.button,
          styles.primary,
          pressed && styles.pressed,
        ]}
        onPress={restart}
      >
        <Text style={styles.primaryLabel}>Try again</Text>
      </Pressable>
      <Pressable
        style={({ pressed }) => [
          styles.button,
          styles.secondary,
          pressed && styles.pressed,
        ]}
        onPress={() => void signOut()}
      >
        <Text style={styles.secondaryLabel}>Sign out</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { gap: 10 },
  button: {
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
  },
  primary: { backgroundColor: palette.primary },
  primaryLabel: {
    color: palette.primaryForeground,
    fontSize: 16,
    fontWeight: "600",
  },
  secondary: {
    backgroundColor: palette.secondary,
    borderWidth: 1,
    borderColor: palette.border,
  },
  secondaryLabel: {
    color: palette.foreground,
    fontSize: 16,
    fontWeight: "600",
  },
  pressed: { opacity: 0.8 },
});
