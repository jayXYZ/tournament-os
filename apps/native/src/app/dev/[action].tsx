import { isClerkAPIResponseError, useAuth, useClerk } from "@clerk/expo";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { palette } from "@/lib/palette";

// Session links for automated test runs, in development builds only (see
// "Headless sign-in for test runs" in apps/native/README.md). Sign-in here is
// Google OAuth through AuthView, which a test runner cannot drive, so the
// runner mints a Clerk sign-in ticket with the Backend API and opens
//
//   paperpairings://dev/sign-in?ticket=<ticket>
//
// which ends any current session, redeems the ticket, and returns to the
// screen the link opened over (home when there is none), and
//
//   paperpairings://dev/sign-out
//
// which ends the session the same way. A release build refuses both. The
// ticket is a credential: it is never logged, stored, or shown, and leaving
// this screen drops it from the navigation state.
export default function DevSessionLink() {
  if (!__DEV__) {
    return <Status text="Session links work only in development builds." />;
  }
  return <DevSession />;
}

function DevSession() {
  const { action, ticket } = useLocalSearchParams<{
    action: string;
    ticket?: string;
  }>();
  const { isLoaded } = useAuth();
  const clerk = useClerk();
  const router = useRouter();
  const started = useRef(false);
  const [status, setStatus] = useState("Working…");

  useEffect(() => {
    if (!isLoaded || started.current) {
      return;
    }
    started.current = true;

    const run = async () => {
      if (action !== "sign-in" && action !== "sign-out") {
        setStatus(`Unknown session link: ${action}`);
        return;
      }
      if (action === "sign-in" && !ticket) {
        setStatus("Sign-in link has no ticket.");
        return;
      }
      // Single-session Clerk refuses a sign-in while a session exists.
      await clerk.signOut();
      if (ticket && action === "sign-in") {
        if (!clerk.client) {
          setStatus("Clerk has no client to sign in with.");
          return;
        }
        const attempt = await clerk.client.signIn.create({
          strategy: "ticket",
          ticket,
        });
        if (attempt.status !== "complete" || !attempt.createdSessionId) {
          setStatus(`Sign-in stopped at status ${attempt.status}.`);
          return;
        }
        await clerk.setActive({ session: attempt.createdSessionId });
      }
      if (router.canGoBack()) {
        router.back();
      } else {
        router.replace("/");
      }
    };

    run().catch((error: unknown) => {
      setStatus(
        `Session link failed: ${
          isClerkAPIResponseError(error)
            ? (error.errors[0]?.longMessage ?? error.message)
            : error instanceof Error
              ? error.message
              : "unknown error"
        }`,
      );
    });
  }, [isLoaded, action, ticket, clerk, router]);

  return <Status text={status} />;
}

function Status({ text }: { text: string }) {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.body}>
        <Text style={styles.text}>{text}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  body: { flex: 1, justifyContent: "center", paddingHorizontal: 24 },
  text: { color: palette.mutedForeground, fontSize: 15 },
});
