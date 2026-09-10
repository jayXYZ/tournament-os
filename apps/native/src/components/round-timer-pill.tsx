import { useRoundTimer } from "@paper-pairings/core";
import type { RoundTimer } from "@paper-pairings/core";
import { StyleSheet, Text, View } from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { palette } from "@/lib/palette";

// The Figma "Player / App bar" timer pill: outlined, tabular digits, ticked
// locally against the Convex-synced anchors carried on the public event
// query — the same source web reads. Hidden while no timer is set; overtime
// counts up in red.
//
// Not mounted anywhere yet. It was briefly the stack header's `headerRight`,
// but on iOS 26 react-native-screens wraps every header item in its own
// Liquid Glass capsule, which put this pill inside a second pill. It is
// waiting for the custom app bar instead.
export function RoundTimerPill({
  timer,
  style,
}: {
  timer: RoundTimer | null | undefined;
  style?: StyleProp<ViewStyle>;
}) {
  const { phase, remainingMs, formatted } = useRoundTimer(timer);
  if (phase === "idle") {
    return null;
  }

  const overtime = remainingMs < 0;
  return (
    <View style={[styles.pill, style]}>
      <Text
        style={[styles.text, overtime && styles.overtime]}
        accessibilityLabel={`Round timer ${formatted}${
          phase === "paused" ? ", paused" : ""
        }`}
      >
        {phase === "paused" ? "Paused · " : ""}
        {formatted}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  text: {
    color: palette.foreground,
    fontSize: 13,
    fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  overtime: { color: palette.destructive },
});
