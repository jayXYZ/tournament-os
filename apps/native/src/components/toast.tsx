import { useCallback, useEffect, useState } from "react";
import { Animated, Easing, StyleSheet, Text } from "react-native";

import { palette } from "@/lib/palette";

// Native stand-in for the web's sonner toasts: one message at a time, slid
// up from the bottom of the screen and dismissed on its own. Mount <Toast>
// once at the end of a screen so it floats above the content.

export type ToastTone = "default" | "destructive";

export type ToastMessage = {
  // Fresh per `show` call so repeating the same text still restarts the
  // timer and the entrance animation.
  id: number;
  text: string;
  tone: ToastTone;
};

const DISPLAY_MS = 2800;

export function useToast() {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const show = useCallback((text: string, tone: ToastTone = "default") => {
    setToast({ id: Date.now(), text, tone });
  }, []);
  const dismiss = useCallback(() => setToast(null), []);
  return { toast, show, dismiss };
}

export function Toast({
  toast,
  onDismiss,
}: {
  toast: ToastMessage | null;
  onDismiss: () => void;
}) {
  // Lazy state rather than a ref: the value is read during render (the
  // interpolation below), which the refs lint forbids for ref contents.
  const [reveal] = useState(() => new Animated.Value(0));
  // Keeps the last message rendered while it animates out. Adopted during
  // render (the "state from previous renders" pattern) so a new message
  // never waits a commit to appear; only the clear happens later, once the
  // exit animation ends.
  const [visible, setVisible] = useState<ToastMessage | null>(toast);
  if (toast && toast !== visible) {
    setVisible(toast);
  }

  useEffect(() => {
    if (!toast) {
      Animated.timing(reveal, {
        toValue: 0,
        duration: 160,
        easing: Easing.in(Easing.ease),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setVisible(null);
      });
      return;
    }
    reveal.setValue(0);
    Animated.timing(reveal, {
      toValue: 1,
      duration: 200,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    const timer = setTimeout(onDismiss, DISPLAY_MS);
    return () => clearTimeout(timer);
  }, [onDismiss, reveal, toast]);

  if (!visible) {
    return null;
  }

  const destructive = visible.tone === "destructive";
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityLiveRegion="polite"
      style={[
        styles.toast,
        destructive && styles.toastDestructive,
        {
          opacity: reveal,
          transform: [
            {
              translateY: reveal.interpolate({
                inputRange: [0, 1],
                outputRange: [12, 0],
              }),
            },
          ],
        },
      ]}
    >
      <Text style={[styles.glyph, destructive && styles.textDestructive]}>
        {destructive ? "!" : "✓"}
      </Text>
      <Text style={[styles.text, destructive && styles.textDestructive]}>
        {visible.text}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: "absolute",
    left: 16,
    right: 16,
    bottom: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.card,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  toastDestructive: { backgroundColor: palette.destructiveMuted },
  glyph: { color: palette.foreground, fontSize: 15, fontWeight: "700" },
  text: { color: palette.foreground, fontSize: 14, flexShrink: 1 },
  textDestructive: { color: palette.destructive },
});
