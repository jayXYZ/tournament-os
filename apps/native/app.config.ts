import type { ExpoConfig } from "expo/config";

// Spelled with its extension: Expo evaluates this file through Node's own
// module loader, which only resolves TypeScript imports when the `.ts` is
// explicit.
import { palette } from "./src/lib/palette.ts";

// Typed so the window, splash, and adaptive-icon backgrounds share the
// palette's `background` instead of restating the hex in three places.
const config: ExpoConfig = {
  name: "Paper Pairings",
  slug: "paper-pairings-native",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/images/icon.png",
  scheme: "paperpairings",
  userInterfaceStyle: "dark",
  backgroundColor: palette.background,
  ios: {
    icon: "./assets/expo.icon",
    bundleIdentifier: "com.paperpairings.app",
  },
  android: {
    package: "com.paperpairings.app",
    adaptiveIcon: {
      backgroundColor: palette.background,
      foregroundImage: "./assets/images/android-icon-foreground.png",
      backgroundImage: "./assets/images/android-icon-background.png",
      monochromeImage: "./assets/images/android-icon-monochrome.png",
    },
    predictiveBackGestureEnabled: false,
  },
  web: {
    output: "static",
    favicon: "./assets/images/favicon.png",
  },
  plugins: [
    "expo-router",
    [
      "expo-splash-screen",
      {
        image: "./assets/images/splash-icon.png",
        imageWidth: 120,
        backgroundColor: palette.background,
      },
    ],
    "expo-secure-store",
    "@clerk/expo",
    "@sentry/react-native",
    "expo-web-browser",
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: false,
  },
};

export default config;
