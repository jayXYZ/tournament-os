// getSentryExpoConfig extends expo/metro-config's getDefaultConfig with the
// serializer Sentry needs to attach debug IDs for source-map symbolication.
// Expo's default config detects the monorepo on its own: it watches every
// workspace package and resolves from the app's node_modules, then the root's.
const { getSentryExpoConfig } = require("@sentry/react-native/metro");

module.exports = getSentryExpoConfig(__dirname);
