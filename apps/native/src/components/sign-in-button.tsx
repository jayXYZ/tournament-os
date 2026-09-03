import { AuthView } from "@clerk/expo/native";
import { useState } from "react";
import { Modal, Pressable, StyleSheet, Text } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { palette } from "@/lib/palette";

// The primary sign-in call to action plus the Clerk sheet it opens. Every
// signed-out branch renders this: Convex also treats Clerk sessions with
// pending tasks (e.g. MFA) as signed out, and AuthView completes those tasks
// too, so the button is the path back to a working session rather than a
// dead end.
export function SignInButton({ style }: { style?: StyleProp<ViewStyle> }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Pressable
        style={({ pressed }) => [
          styles.button,
          pressed && styles.pressed,
          style,
        ]}
        onPress={() => setOpen(true)}
      >
        <Text style={styles.label}>Sign in</Text>
      </Pressable>
      <Modal
        visible={open}
        presentationStyle="pageSheet"
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <AuthView onDismiss={() => setOpen(false)} />
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: palette.primary,
    borderRadius: 12,
    paddingVertical: 15,
    alignItems: "center",
  },
  label: {
    color: palette.primaryForeground,
    fontSize: 16,
    fontWeight: "600",
  },
  pressed: { opacity: 0.8 },
});
