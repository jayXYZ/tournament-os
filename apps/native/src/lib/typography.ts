import { Geist_500Medium } from "@expo-google-fonts/geist";
import { useFonts } from "expo-font";
import type { TextStyle } from "react-native";

// Font families the native app loads beyond the platform default. Geist is
// the web app's display face (`--font-geist-sans` in app.css); native ships
// only the Medium weight, used for the scoreboard numerals. UI text stays on
// the platform font, matching the rest of the app.
export const fonts = {
  numeral: "Geist_500Medium",
} as const;

const numeralFontMap = { [fonts.numeral]: Geist_500Medium };
const numeralFontStyle: TextStyle = { fontFamily: fonts.numeral };

// The numeral face as a style, or null until it is registered. Nothing waits
// on the font: the root layout calls this once so the load starts at launch,
// and the scoreboard calls it again where the numerals render — expo-font
// answers from its cache, so by then the face is normally already there. If
// the load is still in flight (or failed) the numerals draw in the platform
// font and switch over once it lands, instead of the whole app holding its
// splash for a face only one screen uses.
export function useNumeralFont(): TextStyle | null {
  const [loaded] = useFonts(numeralFontMap);
  return loaded ? numeralFontStyle : null;
}
