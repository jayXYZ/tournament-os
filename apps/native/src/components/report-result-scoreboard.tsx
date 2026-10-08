import {
  describeResultPreview,
  mutationErrorMessage,
  useReportResult,
} from "@paper-pairings/core";
import type { CurrentMatchAction } from "@paper-pairings/core";
import {
  MAX_GAME_DRAWS,
  maxGameWinsGiven,
} from "@paper-pairings/shared/match-structure";
import { useState } from "react";
import {
  Animated,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { HoldButton } from "@/components/hold-button";
import { fonts } from "@/lib/typography";
import { palette } from "@/lib/palette";

// The player's report surface while their match is live, from the Figma
// "Match result explorations" page: the two game-win counts are the page,
// stepped by tapping the upper (+) or lower (−) half of each numeral, drawn
// games hide behind a one-line prompt, and submitting is a hold, not a tap —
// a reported result counts the moment it lands (there is no opponent
// confirmation), so the deliberate gesture stands in for a confirm step.
export function ReportResultScoreboard({
  action,
  label,
  title,
  onReported,
  onError,
}: {
  action: CurrentMatchAction;
  /** The presenter's card eyebrow, e.g. "Round 2" or "Round 2 · Final round". */
  label: string;
  /** The presenter's card title, e.g. "Table 4". */
  title: string;
  onReported: () => void;
  onError: (message: string) => void;
}) {
  const { matchId, bestOf, opponentName } = action;
  const reportResult = useReportResult();
  const [myGameWins, setMyGameWins] = useState(0);
  const [opponentGameWins, setOpponentGameWins] = useState(0);
  // Each side's ceiling depends on the other's count, so the steppers can
  // never build a scoreline the backend's gameWinsEntryError would reject
  // (2–2 in a best-of-3): once one side reaches a total the structure
  // allows, the other side's "+" goes dark instead of the hold failing.
  const myMaxGameWins = maxGameWinsGiven(bestOf, opponentGameWins);
  const opponentMaxGameWins = maxGameWinsGiven(bestOf, myGameWins);
  const [gameDraws, setGameDraws] = useState(0);
  const [drawsRevealed, setDrawsRevealed] = useState(false);
  const [busy, setBusy] = useState(false);

  // Rejections rethrow so the hold button rewinds for another try; the
  // message goes to the screen's toast first (rate-limited rejections get
  // the retry-later treatment from mutationErrorMessage).
  //
  // TODO: holding at 0–0 is how a player reports an intentional draw, but
  // it is also one hold away from an accidental report. When the entry is a
  // 0–0 draw, prompt before submitting: "Was this an intentional draw?" and
  // record the draw count that matches the answer. Confirm the MTR's
  // encodings first: it is unclear which of 0–0–3 and 0–0–1 is the
  // intentional draw. Older judge guidance gives intentional draws as
  // 0–0–3 (WER's draw button entered 0–0–1), and an unintentional draw at
  // time as the games actually played. Mirror the prompt in the web
  // report dialog.
  async function submit() {
    setBusy(true);
    try {
      await reportResult({ matchId, myGameWins, opponentGameWins, gameDraws });
      onReported();
    } catch (error) {
      onError(mutationErrorMessage(error, "Could not report the result."));
      throw error;
    } finally {
      setBusy(false);
    }
  }

  // The leading side stays foreground; the trailing side drops to muted so
  // the result reads before the preview line does.
  const myTone: NumeralTone =
    myGameWins < opponentGameWins ? "trailing" : "leading";
  const opponentTone: NumeralTone =
    opponentGameWins < myGameWins ? "trailing" : "leading";
  const preview = describeResultPreview(
    myGameWins,
    opponentGameWins,
    gameDraws,
    opponentName,
  );

  return (
    <View style={styles.root}>
      {/* Round over table, stacked and centred: the step header from the
          design with the round taking the place of the best-of line. */}
      <View style={styles.stepHeader}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.title}>{title}</Text>
      </View>

      <View style={styles.scoreboard}>
        <View style={styles.columns}>
          <ScoreColumn
            label="You"
            value={myGameWins}
            max={myMaxGameWins}
            tone={myTone}
            disabled={busy}
            onChange={setMyGameWins}
          />
          <View style={styles.divider}>
            <Text style={styles.dash}>–</Text>
          </View>
          <ScoreColumn
            label={opponentName}
            value={opponentGameWins}
            max={opponentMaxGameWins}
            tone={opponentTone}
            disabled={busy}
            onChange={setOpponentGameWins}
          />
        </View>

        {drawsRevealed ? (
          <DrawsStepper
            value={gameDraws}
            disabled={busy}
            onChange={setGameDraws}
          />
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityHint="Shows a counter for drawn games"
            onPress={() => setDrawsRevealed(true)}
            style={({ pressed }) => [
              styles.drawsPrompt,
              pressed && styles.pressedTint,
            ]}
          >
            <Text style={styles.drawsPromptText}>
              Did any games end in a draw?
            </Text>
          </Pressable>
        )}
      </View>

      <View style={styles.footer}>
        <Text style={styles.preview}>{preview}</Text>
        {/* No successLabel: the mutation resolves only once the current-match
            query reflects the report, so this card has already unmounted by
            then and the screen's toast is the confirmation. The preview is
            also what a screen reader hears when its first activation arms
            the button, so the readback matches what a sighted player sees. */}
        <HoldButton
          label="Hold to submit result"
          accessibilityDescription={preview}
          disabled={busy}
          onConfirm={submit}
        />
      </View>
    </View>
  );
}

type NumeralTone = "leading" | "trailing";

// One player's count. The +/− glyphs are signposts, not buttons: the tap
// targets are the invisible upper and lower halves of the whole numeral
// block, so a thumb never has to find a 32px control.
//
// To a screen reader the block is one adjustable control (a stepper), not
// two unlabelled halves plus loose glyphs: swipe up/down (VoiceOver) or the
// adjust actions (TalkBack) step the count, and the value is announced after
// each step. The halves still take direct touches.
function ScoreColumn({
  label,
  value,
  max,
  tone,
  disabled,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  tone: NumeralTone;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const canIncrement = !disabled && value < max;
  const canDecrement = !disabled && value > 0;
  // Which half is under a finger right now: its glyph brightens so the
  // signpost answers the touch, not just the count.
  const [held, setHeld] = useState<Half | null>(null);
  // Press tints, one per half. Lazy state rather than refs: they are read
  // during render (the opacity bindings), which the refs lint forbids for
  // ref contents.
  const [upperTint] = useState(() => new Animated.Value(0));
  const [lowerTint] = useState(() => new Animated.Value(0));
  const increment = () => {
    if (canIncrement) onChange(value + 1);
  };
  const decrement = () => {
    if (canDecrement) onChange(value - 1);
  };
  return (
    <View style={styles.column}>
      <Text style={styles.columnLabel} numberOfLines={1}>
        {label}
      </Text>
      <View
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={`Game wins for ${label}`}
        accessibilityValue={{ min: 0, max, now: value, text: String(value) }}
        accessibilityState={{ disabled }}
        accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
        onAccessibilityAction={(event) => {
          const { actionName } = event.nativeEvent;
          if (actionName === "increment") increment();
          else if (actionName === "decrement") decrement();
        }}
        // `accessible` folds the glyphs, numeral and hit areas into this one
        // element, so there is a single focus stop per player and nothing
        // stray to swipe to; the children opt out explicitly as well below.
        style={styles.stepper}
      >
        {/* Painted first so they sit behind the glyphs and the numeral;
            absolute children stack in source order. The hit areas below
            stay transparent and only route touches. */}
        <Animated.View
          pointerEvents="none"
          style={[styles.tint, styles.upperHalf, { opacity: upperTint }]}
        />
        <Animated.View
          pointerEvents="none"
          style={[styles.tint, styles.lowerHalf, { opacity: lowerTint }]}
        />
        <Text
          {...hiddenFromReader}
          style={[
            styles.glyph,
            !canIncrement && styles.glyphDisabled,
            held === "upper" && styles.glyphHeld,
          ]}
        >
          +
        </Text>
        <Text
          {...hiddenFromReader}
          style={[
            styles.numeral,
            tone === "trailing" && styles.numeralTrailing,
          ]}
        >
          {value}
        </Text>
        <Text
          {...hiddenFromReader}
          style={[
            styles.glyph,
            !canDecrement && styles.glyphDisabled,
            held === "lower" && styles.glyphHeld,
          ]}
        >
          −
        </Text>
        <HitArea
          half="upper"
          tint={upperTint}
          disabled={!canIncrement}
          onPress={increment}
          onHeldChange={(isHeld) => setHeld(isHeld ? "upper" : null)}
        />
        <HitArea
          half="lower"
          tint={lowerTint}
          disabled={!canDecrement}
          onPress={decrement}
          onHeldChange={(isHeld) => setHeld(isHeld ? "lower" : null)}
        />
      </View>
    </View>
  );
}

type Half = "upper" | "lower";

// Props for the pieces inside an adjustable stepper that must not surface
// as their own accessibility elements (the parent speaks for them).
const hiddenFromReader = {
  accessible: false,
  accessibilityElementsHidden: true,
  importantForAccessibility: "no-hide-descendants",
} as const;

// One invisible half of the numeral block. With no button chrome, the tint
// is the only thing that tells a thumb where it landed, so it appears the
// instant the touch starts and lingers through a short fade after release —
// a quick tap would otherwise show it for a frame or two at most. The tint
// layer itself is rendered by the column, behind the text; this only drives
// its opacity. It is touch-only: the column's adjustable role is the
// screen-reader path.
function HitArea({
  half,
  tint,
  disabled,
  onPress,
  onHeldChange,
}: {
  half: Half;
  tint: Animated.Value;
  disabled: boolean;
  onPress: () => void;
  onHeldChange: (held: boolean) => void;
}) {
  return (
    <Pressable
      {...hiddenFromReader}
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => {
        tint.stopAnimation();
        tint.setValue(1);
        onHeldChange(true);
      }}
      onPressOut={() => {
        onHeldChange(false);
        Animated.timing(tint, {
          toValue: 0,
          duration: 220,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }).start();
      }}
      style={[
        styles.hitArea,
        half === "upper" ? styles.upperHalf : styles.lowerHalf,
      ]}
    />
  );
}

// Drawn games are the uncommon case, so once revealed they get the compact
// row the web dialog uses rather than a third scoreboard column.
function DrawsStepper({
  value,
  disabled,
  onChange,
}: {
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const canIncrement = !disabled && value < MAX_GAME_DRAWS;
  const canDecrement = !disabled && value > 0;
  const increment = () => {
    if (canIncrement) onChange(value + 1);
  };
  const decrement = () => {
    if (canDecrement) onChange(value - 1);
  };
  // One adjustable control to a screen reader, like the score columns.
  return (
    <View
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel="Drawn games"
      accessibilityValue={{
        min: 0,
        max: MAX_GAME_DRAWS,
        now: value,
        text: String(value),
      }}
      accessibilityState={{ disabled }}
      accessibilityActions={[{ name: "increment" }, { name: "decrement" }]}
      onAccessibilityAction={(event) => {
        const { actionName } = event.nativeEvent;
        if (actionName === "increment") increment();
        else if (actionName === "decrement") decrement();
      }}
      style={styles.drawsRow}
    >
      <Text {...hiddenFromReader} style={styles.drawsLabel}>
        Drawn games
      </Text>
      <View style={styles.drawsControls}>
        <StepButton glyph="−" disabled={!canDecrement} onPress={decrement} />
        <Text {...hiddenFromReader} style={styles.drawsValue}>
          {value}
        </Text>
        <StepButton glyph="+" disabled={!canIncrement} onPress={increment} />
      </View>
    </View>
  );
}

function StepButton({
  glyph,
  disabled,
  onPress,
}: {
  glyph: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      {...hiddenFromReader}
      disabled={disabled}
      onPress={onPress}
      hitSlop={6}
      style={({ pressed }) => [
        styles.stepButton,
        disabled && styles.stepButtonDisabled,
        pressed && styles.pressedTint,
      ]}
    >
      <Text style={styles.stepButtonGlyph}>{glyph}</Text>
    </Pressable>
  );
}

// Fixed line boxes so the layout is predictable without measuring. Every
// Geist line height here is above the font's natural height: below it, iOS
// clamps the line and crops the ascent upward (the digit rides into the "+"
// row and its visual centre drifts above the block's), while at or above it
// both platforms centre the glyph in the box. The stack is kept symmetric —
// glyph, numeral, glyph, with the numeral overlapping both rows equally — so
// the block's midpoint, where the two touch halves meet, is the digit's.
const LABEL_HEIGHT = 20;
const COLUMN_GAP = 8;
const GLYPH_SIZE = 36;
const GLYPH_HEIGHT = 40;
const NUMERAL_SIZE = 128;
const NUMERAL_HEIGHT = 152;
// How far the numeral's line box reaches into the glyph rows above and
// below, tucking the signposts against the digit without overlapping it.
const NUMERAL_OVERLAP = 16;
const DASH_SIZE = 80;
const DASH_HEIGHT = 96;
// An en dash sits at x-height, a little under the centre of its line box,
// where the digits' cap height lands; nudge it up to meet them.
const DASH_OPTICAL_NUDGE = 6;
// Dash top = label + gap + glyph row − overlap + half the numeral box, minus
// half the dash box.
const DASH_OFFSET =
  LABEL_HEIGHT +
  COLUMN_GAP +
  GLYPH_HEIGHT -
  NUMERAL_OVERLAP +
  (NUMERAL_HEIGHT - DASH_HEIGHT) / 2 -
  DASH_OPTICAL_NUDGE;

const styles = StyleSheet.create({
  root: { gap: 40 },
  stepHeader: { alignItems: "center", gap: 2 },
  label: {
    color: palette.mutedForeground,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
    textAlign: "center",
  },
  title: {
    color: palette.foreground,
    fontSize: 18,
    fontWeight: "600",
    lineHeight: 28,
    textAlign: "center",
  },
  scoreboard: { gap: 12 },
  columns: { flexDirection: "row", alignItems: "flex-start" },
  column: { flex: 1, alignItems: "center", gap: COLUMN_GAP },
  columnLabel: {
    color: palette.foreground,
    fontSize: 14,
    fontWeight: "500",
    lineHeight: LABEL_HEIGHT,
  },
  stepper: { alignSelf: "stretch", alignItems: "center" },
  glyph: {
    fontFamily: fonts.numeral,
    fontSize: GLYPH_SIZE,
    lineHeight: GLYPH_HEIGHT,
    color: palette.mutedForeground,
    includeFontPadding: false,
    textAlign: "center",
  },
  glyphDisabled: { opacity: 0.4 },
  glyphHeld: { color: palette.foreground },
  numeral: {
    fontFamily: fonts.numeral,
    fontSize: NUMERAL_SIZE,
    lineHeight: NUMERAL_HEIGHT,
    color: palette.foreground,
    fontVariant: ["tabular-nums"],
    includeFontPadding: false,
    // Symmetric, so the digit stays centred between the two touch halves.
    marginVertical: -NUMERAL_OVERLAP,
  },
  numeralTrailing: { color: palette.mutedForeground },
  // Both the tint layers and the touch targets cover one half of the
  // stepper block; the tint is a real surface, the hit area stays clear.
  upperHalf: { top: 0 },
  lowerHalf: { bottom: 0 },
  tint: {
    position: "absolute",
    left: 0,
    right: 0,
    height: "50%",
    borderRadius: 12,
    // The web's `bg-accent` press state, which the dark palette shares with
    // `secondary`: a step up from the background, well under the text.
    backgroundColor: palette.secondary,
  },
  hitArea: {
    position: "absolute",
    left: 0,
    right: 0,
    height: "50%",
  },
  // Press feedback for the ordinary controls (draw prompt, draw steppers).
  pressedTint: { backgroundColor: palette.secondary },
  divider: { width: 48, paddingTop: DASH_OFFSET, alignItems: "center" },
  dash: {
    fontFamily: fonts.numeral,
    fontSize: DASH_SIZE,
    lineHeight: DASH_HEIGHT,
    color: palette.mutedForeground,
    opacity: 0.4,
    includeFontPadding: false,
  },
  drawsPrompt: {
    height: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 8,
  },
  drawsPromptText: {
    color: palette.mutedForeground,
    fontSize: 14,
    lineHeight: 20,
    textDecorationLine: "underline",
  },
  drawsRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  drawsLabel: {
    color: palette.foreground,
    fontSize: 14,
    fontWeight: "500",
    flexShrink: 1,
  },
  drawsControls: { flexDirection: "row", alignItems: "center", gap: 8 },
  drawsValue: {
    color: palette.foreground,
    fontSize: 18,
    fontWeight: "600",
    width: 28,
    textAlign: "center",
    fontVariant: ["tabular-nums"],
  },
  stepButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: "center",
    justifyContent: "center",
  },
  stepButtonDisabled: { opacity: 0.4 },
  stepButtonGlyph: { color: palette.foreground, fontSize: 18, lineHeight: 22 },
  footer: { gap: 16 },
  preview: {
    color: palette.foreground,
    fontSize: 20,
    fontWeight: "600",
    lineHeight: 28,
    textAlign: "center",
  },
});
