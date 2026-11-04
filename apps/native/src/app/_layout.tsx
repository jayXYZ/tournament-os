import { ClerkProvider, useAuth } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import {
  ConvexClerkAuthProvider,
  useEnsureUserRow,
} from "@paper-pairings/core";
import * as Sentry from "@sentry/react-native";
import { DarkTheme, Stack, ThemeProvider } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as SystemUI from "expo-system-ui";
import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { convex } from "@/lib/convex";
import { palette } from "@/lib/palette";
import { useNumeralFont } from "@/lib/typography";

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
  // Starts the scoreboard's numeral face loading at launch (see
  // lib/typography.ts). Nothing here waits on it: auth, Convex, and the
  // first screen mount right away and expo-router hides the splash as soon
  // as navigation is ready. The scoreboard picks the face up itself once
  // it is registered.
  useNumeralFont();

  // Paints the native root window background at runtime. The window sits below
  // React Navigation entirely, so it's what shows through during swipe-back and
  // in the seam between screens mid-transition. `app.config.ts`'s backgroundColor
  // covers the same surface but only after a native rebuild; this applies on a
  // JS reload too.
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(palette.background);
  }, []);

  return (
    <ClerkProvider publishableKey={publishableKey} tokenCache={tokenCache}>
      <ConvexClerkAuthProvider client={convex} useAuth={useAuth}>
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
        <EnsureUserRow />
      </ConvexClerkAuthProvider>
    </ClerkProvider>
  );
}

// The app's sign-in (see @paper-pairings/core useEnsureUserRow): runs once
// Convex verifies the viewer, so the users row exists and the entries an
// organizer enrolled under the account's email are claimed before the home
// screen lists the viewer's tournaments. No screen gates on its outcome —
// a refusal leaves the list as it would be without a row — but a refusal is
// not silent: an enrolled player whose identity carries no name would
// otherwise see "No active tournaments" with nothing to explain the seat
// they were told they have. The backend's message (written for the user
// when it is one) floats above whichever screen is up, with a retry.
// Rendered after the navigator so it paints over it.
function EnsureUserRow() {
  const { failure, retry } = useEnsureUserRow();
  const insets = useSafeAreaInsets();
  if (!failure) {
    return null;
  }
  return (
    <View
      style={[styles.signInFailure, { top: insets.top + 8 }]}
      accessibilityLiveRegion="polite"
    >
      <Text style={styles.signInFailureText}>{failure}</Text>
      <Pressable
        style={({ pressed }) => [
          styles.signInFailureButton,
          pressed && styles.signInFailureButtonPressed,
        ]}
        onPress={retry}
        accessibilityRole="button"
      >
        <Text style={styles.signInFailureButtonLabel}>Try again</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  signInFailure: {
    position: "absolute",
    left: 16,
    right: 16,
    gap: 10,
    padding: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.destructiveMuted,
    shadowColor: "#000",
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  signInFailureText: { color: palette.destructive, fontSize: 14 },
  signInFailureButton: {
    alignSelf: "flex-start",
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 9,
    backgroundColor: palette.primary,
  },
  signInFailureButtonPressed: { opacity: 0.8 },
  signInFailureButtonLabel: {
    color: palette.primaryForeground,
    fontSize: 14,
    fontWeight: "600",
  },
});

export default sentryDsn ? Sentry.wrap(RootLayout) : RootLayout;
