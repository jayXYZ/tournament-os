// Paper Pairings palette — the native mirror of the web theme's `.dark` block
// (apps/web/src/styles/app.css), limited to the tokens native uses. The app is
// always dark (see `userInterfaceStyle` in app.config.ts), so only the dark
// ramp lives here. Values are the sRGB hex of the web's oklch tokens; change
// both files together when the brand shifts.
//
// `background` is also the window, splash, and adaptive-icon background in
// app.config.ts and the favicon tile in scripts/render-brand-assets.mjs, so
// the hex lives here alone.
export const palette = {
  background: "#171514",
  foreground: "#EDE9E0",
  card: "#262321",
  // Web's secondary / muted / accent all share this surface tone.
  secondary: "#32302C",
  mutedForeground: "#B8B2A6",
  primary: "#EDE9E0",
  primaryForeground: "#171514",
  border: "rgba(237, 233, 224, 0.10)",
  // The outline badge's tinted background (`bg-input/30` on web: the 15%
  // input token at 30% opacity, so ~4.5% of paper white).
  inputMuted: "rgba(237, 233, 224, 0.045)",
  destructive: "#FF6467",
  // The destructive badge's tinted background (`bg-destructive/20` on web).
  destructiveMuted: "rgba(255, 100, 103, 0.20)",
} as const;
