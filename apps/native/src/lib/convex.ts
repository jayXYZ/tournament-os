import { ConvexReactClient } from 'convex/react';

const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;

if (!convexUrl) {
  throw new Error(
    'Missing EXPO_PUBLIC_CONVEX_URL. Copy apps/native/.env.example to .env.local and fill it in.',
  );
}

export const convex = new ConvexReactClient(convexUrl, {
  // React Native has no "before unload"; the warning is a no-op here.
  unsavedChangesWarning: false,
});
