import { ClerkProvider, useAuth } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { ConvexProviderWithClerk } from 'convex/react-clerk';
import { DarkTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';

import { convex } from '@/lib/convex';

const APP_BACKGROUND = '#0b0b0f';

// react-native-screens paints each native screen container with the navigation
// theme's `colors.background`. expo-router defaults to the light theme (white),
// which is what's exposed during swipe-back and in the seam between screens
// mid-transition — above the window (so SystemUI can't reach it) and outside
// each screen's content (so contentStyle can't reach it).
const navigationTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    background: APP_BACKGROUND,
    card: APP_BACKGROUND,
  },
};

const envPublishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;

if (!envPublishableKey) {
  throw new Error(
    'Missing EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY. Copy apps/native/.env.example to .env.local and fill it in.',
  );
}

// Captured into a narrowed const so the type stays `string` inside the
// component closure (TS widens the guarded module-level binding back to
// `string | undefined` across closures).
const publishableKey: string = envPublishableKey;

export default function RootLayout() {
  // Paints the native root window background at runtime. The window sits below
  // React Navigation entirely, so it's what shows through during swipe-back and
  // in the seam between screens mid-transition. `app.json`'s backgroundColor
  // covers the same surface but only after a native rebuild; this applies on a
  // JS reload too.
  useEffect(() => {
    SystemUI.setBackgroundColorAsync(APP_BACKGROUND);
  }, []);

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
              contentStyle: { backgroundColor: APP_BACKGROUND },
            }}
          >
            <Stack.Screen name="index" />
            <Stack.Screen
              name="tournament/[id]"
              options={{
                headerShown: true,
                title: "Tournament",
                headerStyle: { backgroundColor: APP_BACKGROUND },
                headerTintColor: "#fff",
              }}
            />
          </Stack>
        </ThemeProvider>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}
