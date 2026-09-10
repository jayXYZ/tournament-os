// Font families the native app loads beyond the platform default. The keys
// are the names registered with expo-font in app/_layout.tsx, so a `fontFamily`
// here always resolves once the root layout has rendered.
//
// Geist is the web app's display face (`--font-geist-sans` in app.css); native
// ships only the Medium weight, used for the scoreboard numerals. UI text stays
// on the platform font, matching the rest of the app.
export const fonts = {
  numeral: "Geist_500Medium",
} as const;
