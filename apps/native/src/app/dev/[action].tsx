import { isClerkAPIResponseError, useAuth, useClerk } from "@clerk/expo";
import {
  Redirect,
  useLocalSearchParams,
  useNavigation,
  useRouter,
} from "expo-router";
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
// which ends any current session, redeems the ticket, and closes this screen,
// returning to the screen the link opened over (home when there is none), and
//
//   paperpairings://dev/sign-out
//
// which ends the session the same way. A release build sends either link
// home rather than leaving a stray link on a dead-end screen. The ticket is
// a credential: it is never logged, stored, or shown, and leaving this
// screen drops it from the navigation state.
export default function DevSessionLink() {
  if (!__DEV__) {
    return <Redirect href="/" />;
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
  const navigation = useNavigation();
  // The link this screen last acted on. A second session link re-renders
  // this screen rather than mounting a new one when expo-router keeps the
  // route (it is keyed on `action`), so the guard is per link, not per
  // mount: a link with a new ticket after a failed one still runs. Held in
  // memory only, like the route params it copies.
  const handled = useRef<string | null>(null);
  const [status, setStatus] = useState("Working…");

  useEffect(() => {
    const link = `${action}:${ticket ?? ""}`;
    if (!isLoaded || handled.current === link) {
      return;
    }
    handled.current = link;
    setStatus("Working…");

    // Closes this screen, not whatever is on top: a link that arrived
    // while the session was changing may have pushed a screen above it,
    // and router.back() would pop that one instead. A POP aimed at this
    // stack carries this screen's key as its source (the screen's own
    // dispatch adds it), which the stack router removes wherever it sits.
    const close = () => {
      const stack = navigation.getState();
      if (stack !== undefined && navigation.canGoBack()) {
        navigation.dispatch({
          type: "POP",
          payload: { count: 1 },
          target: stack.key,
        });
      } else {
        router.replace("/");
      }
    };

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
      close();
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
  }, [isLoaded, action, ticket, clerk, router, navigation]);

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
