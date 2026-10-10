import { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import type { StyleProp, ViewStyle } from "react-native";

import { palette } from "@/lib/palette";

// Native port of the web HoldButton (apps/web/src/components/ui/hold-button.tsx):
// the timings and phases match so a hold feels the same on both clients.
//
// Releasing early rewinds the fill this many times faster than it filled, so
// an aborted hold snaps back without feeling like a penalty.
const REWIND_FACTOR = 3;
const SUCCESS_DISPLAY_MS = 1400;
// How long a screen-reader activation stays armed waiting for the confirming
// second activation before the button quietly disarms.
const ARMED_TIMEOUT_MS = 5000;

type HoldPhase = "idle" | "holding" | "armed" | "pending" | "success";

/**
 * A button for actions too consequential for a single tap. The user must
 * hold it for `holdDuration` ms while an inversion sweep fills the face;
 * releasing early rewinds. When the hold completes, `onConfirm` runs and,
 * given a `successLabel`, the button confirms success in place before
 * resetting. Omit `successLabel` when a successful action unmounts the
 * button (the screen confirms it some other way): the flash could never show.
 *
 * `onConfirm` must reject (rethrow) on failure so the success state is
 * skipped — surface the error yourself (e.g. a toast) before rethrowing.
 *
 * Screen readers cannot hold: their double-tap lands as a press-in/press-out
 * a few ms apart. For them the button is two-step instead — the first
 * activation arms it and announces what is about to happen, the second
 * confirms — so the deliberate gesture survives without a dialog. A
 * double-tap-and-hold still passes a real touch through to the pressable
 * and completes an ordinary hold.
 */
export function HoldButton({
  label,
  successLabel,
  accessibilityDescription,
  onConfirm,
  holdDuration = 800,
  disabled = false,
  style,
}: {
  label: string;
  /** Shown on the button once `onConfirm` resolves; omit to skip the flash. */
  successLabel?: string;
  /**
   * What confirming will do, read to screen-reader users when the first
   * activation arms the button, e.g. "You win 2–1". Should match whatever
   * preview a sighted user sees beside the button.
   */
  accessibilityDescription?: string;
  onConfirm: () => Promise<unknown> | unknown;
  /** Milliseconds the button must be held before the action fires. */
  holdDuration?: number;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  // Lazy state rather than a ref: the values are read during render (the
  // interpolations below), which the refs lint forbids for ref contents.
  const [progress] = useState(() => new Animated.Value(0));
  const [pulse] = useState(() => new Animated.Value(1));
  const phaseRef = useRef<HoldPhase>("idle");
  const [phase, setPhaseState] = useState<HoldPhase>("idle");
  // Captured when the hold completes: the live props may change mid-flight
  // (reactive queries swap the button to its next action) and the success
  // flash must describe the action that actually ran.
  const [confirmedLabel, setConfirmedLabel] = useState("");
  // The overlay is clipped to the fill width, so its label needs the full
  // button width to stay put instead of reflowing as the sweep grows.
  const [width, setWidth] = useState(0);
  const mountedRef = useRef(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Under reduce motion the hold is timed rather than animated; this is the
  // timer that fires the action, cleared by an early release.
  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Disarms an armed (screen-reader) button that never got its second tap.
  const armedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduceMotion = useReducedMotion();

  // Keep latest callbacks/props readable from stable animation callbacks.
  // Synced after commit, which is early enough: they are only read from
  // gesture and animation callbacks, never during render.
  const onConfirmRef = useRef(onConfirm);
  const successLabelRef = useRef(successLabel);
  const descriptionRef = useRef(accessibilityDescription);
  useEffect(() => {
    onConfirmRef.current = onConfirm;
    successLabelRef.current = successLabel;
    descriptionRef.current = accessibilityDescription;
  });

  const setPhase = useCallback((next: HoldPhase) => {
    phaseRef.current = next;
    setPhaseState(next);
  }, []);

  const rewind = useCallback(
    (settle: () => void) => {
      progress.stopAnimation((value: number) => {
        if (reduceMotion || value <= 0) {
          progress.setValue(0);
          settle();
          return;
        }
        Animated.timing(progress, {
          toValue: 0,
          duration: (value * holdDuration) / REWIND_FACTOR,
          easing: Easing.linear,
          useNativeDriver: false,
        }).start(({ finished }) => {
          if (finished) settle();
        });
      });
    },
    [holdDuration, progress, reduceMotion],
  );

  const retract = useCallback(() => {
    setPhase("idle");
    rewind(() => {});
  }, [rewind, setPhase]);

  const clearHoldTimer = useCallback(() => {
    if (holdTimerRef.current) {
      clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  }, []);

  const clearArmedTimer = useCallback(() => {
    if (armedTimerRef.current) {
      clearTimeout(armedTimerRef.current);
      armedTimerRef.current = null;
    }
  }, []);

  const disarm = useCallback(() => {
    clearArmedTimer();
    if (phaseRef.current !== "armed") return;
    retract();
  }, [clearArmedTimer, retract]);

  const complete = useCallback(() => {
    clearHoldTimer();
    clearArmedTimer();
    progress.stopAnimation();
    progress.setValue(1);
    const confirmed = successLabelRef.current;
    setConfirmedLabel(confirmed ?? "");
    setPhase("pending");
    Promise.resolve()
      .then(() => onConfirmRef.current())
      .then(
        () => {
          if (!mountedRef.current) return;
          if (confirmed === undefined) {
            retract();
            return;
          }
          setPhase("success");
          resetTimerRef.current = setTimeout(retract, SUCCESS_DISPLAY_MS);
        },
        () => {
          if (mountedRef.current) retract();
        },
      );
  }, [clearArmedTimer, clearHoldTimer, progress, retract, setPhase]);

  function press() {
    if (disabled) return;
    const current = phaseRef.current;
    if (current === "pending" || current === "success") return;
    // A new press must start from zero: pressing during a rewind (early
    // release or the post-success retract) must not resume from the residual
    // fill, or the action could fire after a near-zero hold. A real touch
    // while armed (a double-tap-and-hold pass-through) likewise restarts as
    // an ordinary hold rather than confirming.
    clearHoldTimer();
    clearArmedTimer();
    progress.stopAnimation();
    progress.setValue(0);
    setPhase("holding");
    if (reduceMotion) {
      // No sweep: the face inverts at once as a static "held" state and a
      // plain timer keeps the same deliberate delay before the action fires.
      // Releasing early clears the timer and snaps the fill back.
      progress.setValue(1);
      holdTimerRef.current = setTimeout(() => {
        holdTimerRef.current = null;
        if (phaseRef.current === "holding") complete();
      }, holdDuration);
      return;
    }
    Animated.timing(progress, {
      toValue: 1,
      duration: holdDuration,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished && phaseRef.current === "holding") complete();
    });
  }

  // Screen readers turn a double-tap into a press-in/press-out a few ms
  // apart, which can never complete a hold. They activate the button through
  // the "activate" action instead, and a single activation would make this
  // the one control on the screen with no second step. So the first
  // activation arms: the face inverts as if held, and the reader hears what
  // confirming will do. The second activation, within ARMED_TIMEOUT_MS,
  // completes; otherwise the button disarms on its own.
  function activate() {
    if (disabled) return;
    const current = phaseRef.current;
    if (current === "pending" || current === "success") return;
    if (current === "armed") {
      complete();
      return;
    }
    clearHoldTimer();
    progress.stopAnimation();
    progress.setValue(1);
    setPhase("armed");
    clearArmedTimer();
    armedTimerRef.current = setTimeout(() => {
      armedTimerRef.current = null;
      disarm();
    }, ARMED_TIMEOUT_MS);
    const description = descriptionRef.current;
    AccessibilityInfo.announceForAccessibility(
      description
        ? `${description}. Double tap again to confirm.`
        : "Double tap again to confirm.",
    );
  }

  const release = useCallback(() => {
    clearHoldTimer();
    if (phaseRef.current !== "holding") return;
    rewind(() => {
      if (phaseRef.current === "holding") setPhase("idle");
    });
  }, [clearHoldTimer, rewind, setPhase]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      progress.stopAnimation();
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current);
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      if (armedTimerRef.current) clearTimeout(armedTimerRef.current);
    };
  }, [progress]);

  useEffect(() => {
    if (disabled) {
      release();
      disarm();
    }
  }, [disabled, disarm, release]);

  // The armed announcement described a specific outcome; if that changes
  // underneath (a count stepped while armed), the confirmation no longer
  // covers it, so start over.
  useEffect(() => {
    disarm();
  }, [accessibilityDescription, disarm]);

  // The fill breathes while the action is in flight, like the web's
  // hold-pending-pulse keyframes.
  useEffect(() => {
    if (phase !== "pending" || reduceMotion) {
      pulse.stopAnimation();
      pulse.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 0.55,
          duration: 550,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
        Animated.timing(pulse, {
          toValue: 1,
          duration: 550,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: false,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [phase, pulse, reduceMotion]);

  const busy = phase === "pending" || phase === "success";
  const armed = phase === "armed";
  const fillWidth = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, width],
  });

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={
        armed
          ? "Double tap again to confirm"
          : "Double tap to arm, then again to confirm"
      }
      accessibilityState={{ disabled: disabled || busy, busy, selected: armed }}
      accessibilityActions={[{ name: "activate" }]}
      // iOS VoiceOver routes a double-tap through onAccessibilityTap; TalkBack
      // uses the "activate" action. Wire both so screen readers can submit.
      onAccessibilityTap={activate}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "activate") activate();
      }}
      disabled={disabled && !busy}
      onPressIn={press}
      onPressOut={release}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      style={[styles.button, disabled && !busy && styles.buttonDisabled, style]}
    >
      <Text style={styles.label}>{label}</Text>
      <Animated.View
        pointerEvents="none"
        style={[styles.overlay, { width: fillWidth }]}
      >
        <Animated.View style={[styles.overlayFace, { width, opacity: pulse }]}>
          <Text style={styles.overlayLabel}>
            {phase === "success"
              ? `✓ ${confirmedLabel}`
              : armed
                ? "Double tap again to confirm"
                : label}
          </Text>
        </Animated.View>
      </Animated.View>
      {/* Announced once the action lands; mirrors the web's sr-only status. */}
      <View
        accessibilityLiveRegion="polite"
        accessibilityLabel={phase === "success" ? confirmedLabel : undefined}
        style={styles.status}
      />
    </Pressable>
  );
}

// Tracks the OS "reduce motion" setting so the fill can snap instead of
// sweeping, the native counterpart of prefers-reduced-motion on the web.
function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    let cancelled = false;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (!cancelled) setReduced(enabled);
    });
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      setReduced,
    );
    return () => {
      cancelled = true;
      subscription.remove();
    };
  }, []);
  return reduced;
}

const BUTTON_HEIGHT = 48;

const styles = StyleSheet.create({
  button: {
    height: BUTTON_HEIGHT,
    borderRadius: 10,
    backgroundColor: palette.primary,
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  buttonDisabled: { opacity: 0.5 },
  label: {
    color: palette.primaryForeground,
    fontSize: 15,
    fontWeight: "600",
  },
  // The sweep inverts the button: it must contrast with both the idle face
  // and the page behind it, hence the inset ring.
  overlay: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: 0,
    overflow: "hidden",
    borderRadius: 10,
  },
  overlayFace: {
    height: BUTTON_HEIGHT,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.primaryForeground,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "rgba(237, 233, 224, 0.25)",
  },
  overlayLabel: {
    color: palette.primary,
    fontSize: 15,
    fontWeight: "600",
  },
  status: { position: "absolute", width: 0, height: 0 },
});
