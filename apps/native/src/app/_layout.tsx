import { ClerkProvider, useAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { Geist_500Medium } from "@expo-google-fonts/geist";
import * as Sentry from "@sentry/react-native";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useFonts } from "expo-font";
import { DarkTheme, Stack, ThemeProvider } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect } from "react";

import { convex } from "@/lib/convex";
import { palette } from "@/lib/palette";
import { fonts } from "@/lib/typography";

// Holds the splash until the fonts below are registered; called at module
// scope so it lands before expo-router's own auto-hide.
SplashScreen.preventAutoHideAsync();

// No-ops when EXPO_PUBLIC_SENTRY_DSN is unset (local dev without monitoring).
const sentryDsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    tracesSampleRate: 1.0,
  });
}

// react-native-screens paints each native screen container with the navigation
// theme's `colors.background`. expo-router defaults to the light theme (white),
// which is what's exposed during swipe-back and in the seam between screens
// mid-transition — above the window (so SystemUI can't reach it) and outside
// each screen's content (so contentStyle can't reach it).
const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: palette.primary,
    background: palette.background,
    card: palette.background,
    text: palette.foreground,
    border: palette.border,
    notification: palette.destructive,
  },
};

const envPublishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

if (!envPublishableKey) {
  throw new Error(
    "Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY. Copy apps/native/.env.example to .env.local and fill it in.",
  );
}

// Captured into a narrowed const so the type stays `string` inside the
// component closure (TS widens the guarded module-level binding back to
// `string | undefined` across closures).
const publishableKey: string = envPublishableKey;

function RootLayout() {
  // The scoreboard numerals need Geist (see lib/typography.ts); everything
  // else is the platform font. A load failure still lets the app render —
  // the numerals fall back to the platform font rather than blocking start.
  const [fontsLoaded, fontError] = useFonts({
    [fonts.numeral]: Geist_500Medium,
  });
  const fontsReady = fontsLoaded || fontError !== null;
  useEffect(() => {
    if (fontsReady) {
      SplashScreen.hideAsync();
    }
  }, [fontsReady]);

  // Paints the native root window background at runtime. The window sits below
  // React Navigation entirely, so it's what shows through during swipe-back and
  // in the seam between screens mid-transition. `app.config.ts`'s backgroundColor
  // covers the same surface but only after a native rebuild; this applies on a
  // JS reload too.
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(palette.background);
  }, []);

  if (!fontsReady) {
    return null;
  }

  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <ThemeProvider value={navigationTheme}>
          <StatusBar style="light" />
          <Stack
            screenOptions={{
              headerShown: false,
              // Belt-and-suspenders for the screen interiors; the theme above
              // is what actually covers the swipe-back area and the seam.
              contentStyle: { backgroundColor: palette.background },
            }}
          >
            <Stack.Screen name="index" />
            <Stack.Screen
              name="tournament/[code]"
              options={{
                headerShown: true,
                title: "Tournament",
                headerStyle: { backgroundColor: palette.background },
                headerTintColor: palette.foreground,
              }}
            />
          </Stack>
        </ThemeProvider>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}

export default sentryDsn ? Sentry.wrap(RootLayout) : RootLayout;
