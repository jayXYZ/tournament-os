import type { ExpoConfig } from "expo/config";
import { withPodfile } from "expo/config-plugins";
import type { ConfigPlugin } from "expo/config-plugins";

// Spelled with its extension: Expo evaluates this file through Node's own
// module loader, which only resolves TypeScript imports when the `.ts` is
// explicit.
import { palette } from "./src/lib/palette.ts";

// Xcode 27 refuses to build a target whose deployment target is below iOS
// 15, and several pods still declare older ones on their own targets
// (GoogleSignIn, Sentry, and the GTM, Promises, AppAuth, and GoogleUtilities
// privacy bundles). Lifts every pod target to React Native's 15.1 floor in
// the generated Podfile's post_install; targets already above it keep theirs.
const POD_DEPLOYMENT_FLOOR = "15.1";
const podDeploymentFloorMarker = "# app.config.ts: pod deployment floor";
const withPodDeploymentFloor: ConfigPlugin = (config) =>
  withPodfile(config, (podfile) => {
    const anchor = "post_install do |installer|";
    const { contents } = podfile.modResults;
    if (
      !contents.includes(podDeploymentFloorMarker) &&
      contents.includes(anchor)
    ) {
      podfile.modResults.contents = contents.replace(
        anchor,
        [
          anchor,
          `    ${podDeploymentFloorMarker}`,
          "    installer.pods_project.targets.each do |target|",
          "      target.build_configurations.each do |build_config|",
          `        if build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'].to_f < ${POD_DEPLOYMENT_FLOOR}`,
          `          build_config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '${POD_DEPLOYMENT_FLOOR}'`,
          "        end",
          "      end",
          "    end",
        ].join("\n"),
      );
    }
    return podfile;
  });

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
    "expo-image",
    // The scanner (src/app/scan.tsx) only reads QR codes, so the
    // microphone permission stays out of Info.plist and the Android
    // manifest; `android.permission.CAMERA` is always added.
    [
      "expo-camera",
      {
        cameraPermission:
          "Paper Pairings uses the camera to scan tournament QR codes.",
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: false,
  },
};

export default withPodDeploymentFloor(config);
