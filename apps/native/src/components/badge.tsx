import type { BadgeTone } from "@paper-pairings/core";
import { StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { palette } from "@/lib/palette";

// Native mirror of the web Badge variants (apps/web/src/components/ui/badge.tsx),
// keyed by the shared presenter's BadgeTone so tone semantics stay in core and
// the two clients read the same label the same way.
export function Badge({
  tone = "default",
  style,
  children,
}: {
  tone?: BadgeTone;
  style?: StyleProp<ViewStyle>;
  children: string;
}) {
  const colors = tones[tone];
  return (
    <View
      style={[
        styles.badge,
        { backgroundColor: colors.background, borderColor: colors.border },
        style,
      ]}
    >
      <Text style={[styles.label, { color: colors.text }]}>{children}</Text>
    </View>
  );
}

const tones: Record<
  BadgeTone,
  { background: string; border: string; text: string }
> = {
  default: {
    background: palette.primary,
    border: "transparent",
    text: palette.primaryForeground,
  },
  secondary: {
    background: palette.secondary,
    border: "transparent",
    text: palette.foreground,
  },
  outline: {
    background: palette.inputMuted,
    border: palette.border,
    text: palette.foreground,
  },
  destructive: {
    background: palette.destructiveMuted,
    border: "transparent",
    text: palette.destructive,
  },
};

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: 9,
    paddingVertical: 3,
  },
  label: { fontSize: 12, fontWeight: "600" },
});
