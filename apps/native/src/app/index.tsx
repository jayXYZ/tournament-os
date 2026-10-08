import { UserButton } from "@clerk/expo/native";
import { useConvexAuthReadiness, useMyTournaments } from "@paper-pairings/core";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Badge } from "@/components/badge";
import { BrandMark } from "@/components/brand-mark";
import { SignInButton } from "@/components/sign-in-button";
import { palette } from "@/lib/palette";

export default function HomeScreen() {
  const auth = useConvexAuthReadiness();
  const router = useRouter();

  // Player's active tournaments. `undefined` while loading (Convex convention);
  // stays `undefined` until Convex auth is ready, so the token-lag window can
  // never render a false "No active tournaments".
  const tournaments = useMyTournaments();

  if (auth === "pending") {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={palette.mutedForeground} />
      </View>
    );
  }

  // Signed out, or a Clerk session with pending tasks, which Convex treats
  // the same way (see SignInButton).
  if (auth !== "ready") {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.signedOut}>
          <BrandMark size={72} />
          <Text style={styles.brand}>Paper Pairings</Text>
          <Text style={styles.tagline}>
            Sign in to follow your matches and standings live.
          </Text>
          <SignInButton />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <BrandMark size={36} />
        <View style={styles.headerText}>
          <Text style={styles.greeting}>Your tournaments</Text>
          <Text style={styles.subtitle}>
            Active events you’re registered for
          </Text>
        </View>
        <UserButton />
      </View>

      {tournaments === undefined ? (
        <View style={styles.centered}>
          <ActivityIndicator color={palette.mutedForeground} />
        </View>
      ) : (
        <FlatList
          data={tournaments}
          keyExtractor={(item) => item.tournament._id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyTitle}>No active tournaments</Text>
              <Text style={styles.emptyBody}>
                When you register for an event it’ll show up here.
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable
              style={({ pressed }) => [styles.card, pressed && styles.pressed]}
              onPress={() =>
                // Routes carry the public code, not the Convex id, so links
                // are interchangeable with the web app's player pages.
                router.push({
                  pathname: "/tournament/[code]",
                  params: { code: String(item.tournament.publicCode) },
                })
              }
            >
              <Text style={styles.cardTitle}>{item.tournament.name}</Text>
              {item.organizationName ? (
                <Text style={styles.cardOrg}>{item.organizationName}</Text>
              ) : null}
              <Badge tone="outline" style={styles.cardStatus}>
                {item.tournament.lifecycle === "in_progress"
                  ? "In progress"
                  : "Upcoming"}
              </Badge>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: palette.background,
  },
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.background,
  },
  signedOut: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: 24,
    gap: 12,
  },
  brand: {
    color: palette.foreground,
    fontSize: 34,
    fontWeight: "800",
  },
  tagline: {
    color: palette.mutedForeground,
    fontSize: 16,
    marginBottom: 12,
  },
  pressed: { opacity: 0.8 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 16,
  },
  headerText: {
    flex: 1,
  },
  greeting: {
    color: palette.foreground,
    fontSize: 24,
    fontWeight: "700",
  },
  subtitle: {
    color: palette.mutedForeground,
    fontSize: 14,
    marginTop: 2,
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 12,
  },
  card: {
    backgroundColor: palette.card,
    borderRadius: 14,
    padding: 16,
    gap: 4,
  },
  cardTitle: {
    color: palette.foreground,
    fontSize: 17,
    fontWeight: "600",
  },
  cardOrg: {
    color: palette.mutedForeground,
    fontSize: 14,
  },
  cardStatus: { marginTop: 6 },
  empty: {
    alignItems: "center",
    paddingTop: 80,
    paddingHorizontal: 24,
    gap: 8,
  },
  emptyTitle: {
    color: palette.foreground,
    fontSize: 18,
    fontWeight: "600",
  },
  emptyBody: {
    color: palette.mutedForeground,
    fontSize: 14,
    textAlign: "center",
  },
});
