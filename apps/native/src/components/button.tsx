import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { palette } from "@/lib/palette";

// The app's tap button, in the web Button's two most used variants: the
// filled primary call to action and the quieter outline. `busy` shows a
// spinner and blocks presses while the action it started is in flight.
export function Button({
  label,
  onPress,
  variant = "primary",
  busy = false,
  disabled = false,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "outline";
  busy?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const outline = variant === "outline";
  const inactive = busy || disabled;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        outline && styles.outline,
        pressed && styles.pressed,
        disabled && styles.disabled,
        style,
      ]}
    >
      {busy ? (
        <ActivityIndicator
          color={outline ? palette.foreground : palette.primaryForeground}
        />
      ) : null}
      <Text style={[styles.label, outline && styles.outlineLabel]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: palette.primary,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.primary,
    paddingVertical: 15,
    paddingHorizontal: 16,
  },
  outline: {
    backgroundColor: palette.inputMuted,
    borderColor: palette.border,
  },
  pressed: { opacity: 0.8 },
  disabled: { opacity: 0.5 },
  label: {
    color: palette.primaryForeground,
    fontSize: 16,
    fontWeight: "600",
  },
  outlineLabel: { color: palette.foreground },
});
