import {
  badgeGateFor,
  deriveJoinAction,
  mutationErrorMessage,
  useCancelMyRegistration,
  useFeePreview,
  useMyEntryOrder,
  useRegisterSelf,
} from "@paper-pairings/core";
import type {
  JoinAction,
  PlayerRegistration,
  PlayerTournamentEvent,
} from "@paper-pairings/core";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Badge } from "@/components/badge";
import { Button } from "@/components/button";
import { SignInButton } from "@/components/sign-in-button";
import { Toast, useToast } from "@/components/toast";
import { useClientClock } from "@/lib/client-clock";
import { formatCents, formatEventDate } from "@/lib/format";
import { palette } from "@/lib/palette";
import { webConventionUrl, webEventUrl } from "@/lib/web-links";

// The join screen's body (docs/plans/qr-join.md PR 2a): the event summary
// and the one action deriveJoinAction picks for this viewer. It backs both
// /join/<code> and an event page whose viewer holds no confirmed seat.
// Status copy is the web RegistrationPanel's, word for word, until the
// player-side copy is settled (see the plan's Decisions).
export function JoinEventView({
  event,
  signedIn,
  registration,
  inviteCode,
  onOpenEvent,
}: {
  event: PlayerTournamentEvent;
  signedIn: boolean;
  // undefined while it loads; ignored when signed out.
  registration: PlayerRegistration | null | undefined;
  // From a private event's Invite Link: registerSelf needs it to admit a
  // first-time player, and the web hand-off carries it along.
  inviteCode?: string;
  // Leaves for the event's own page. Called once a direct registration
  // takes a seat, and offered on an existing one. Omitted where the caller
  // is the event page, which switches to the match view by itself.
  onOpenEvent?: () => void;
}) {
  const { tournament, organizationName, registeredCount, convention } = event;
  const isPaid = (tournament.entryFeeCents ?? 0) > 0;
  const spotsLeft = Math.max(tournament.playerCapacity - registeredCount, 0);

  // Rounded up, as on the web: the order's cancel outcome reads as a
  // promise, so its clock never runs behind the server's.
  const now = useClientClock({ round: "up" });
  const order = useMyEntryOrder(
    isPaid && signedIn ? tournament._id : null,
    now,
  );
  const feePreview = useFeePreview(isPaid ? tournament.entryFeeCents! : null);
  const registerSelf = useRegisterSelf();
  const cancelRegistration = useCancelMyRegistration();
  const { toast, show, dismiss } = useToast();
  const [busy, setBusy] = useState(false);

  const action = deriveJoinAction({
    tournament,
    signedIn,
    registration,
    order,
    badgeGate: badgeGateFor(convention),
    badgeCompsThisEvent: convention?.myBadgeCompsThisEvent ?? false,
    spotsLeft,
  });

  // Runs one mutation at a time and reports how it went; resolves false on
  // failure, after the toast has said why.
  const run = async (
    work: () => Promise<unknown>,
    success: string,
    fallback: string,
  ) => {
    setBusy(true);
    try {
      await work();
      show(success);
      return true;
    } catch (error) {
      show(mutationErrorMessage(error, fallback), "destructive");
      return false;
    } finally {
      setBusy(false);
    }
  };

  const register = async () => {
    const approval = tournament.registrationRequiresApproval;
    const ok = await run(
      () => registerSelf({ tournamentId: tournament._id, inviteCode }),
      approval
        ? "Registration submitted for organizer approval."
        : "You're registered. See you at the event!",
      "Could not register.",
    );
    // An application stays here and turns into its live pending state.
    if (ok && !approval) {
      onOpenEvent?.();
    }
  };

  const withdraw = () =>
    void run(
      () => cancelRegistration({ tournamentId: tournament._id }),
      "Your registration has been withdrawn.",
      "Could not withdraw your registration.",
    );

  const openOnWeb = async (url: string) => {
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch (error) {
      show(
        mutationErrorMessage(error, "Could not open the browser."),
        "destructive",
      );
    }
  };

  const total = feePreview ? formatCents(feePreview.totalCents) : null;
  const entry = isPaid
    ? feePreview
      ? `${total} (${formatCents(feePreview.entryFeeCents)} entry + ${formatCents(
          feePreview.platformFeeCents + feePreview.processingFeeCents,
        )} fees)`
      : formatCents(tournament.entryFeeCents!)
    : "Free";

  return (
    <SafeAreaView style={styles.container} edges={["bottom"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          {organizationName || convention ? (
            <Text style={styles.eyebrow}>
              {[
                organizationName,
                convention ? `Part of ${convention.name}` : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Text>
          ) : null}
          <Text style={styles.title}>{tournament.name}</Text>
          <Detail
            label="Starts"
            value={formatEventDate(tournament.startDate)}
          />
          <Detail label="Format" value={capitalize(tournament.format)} />
          <Detail
            label="Players"
            value={`${registeredCount} of ${tournament.playerCapacity} registered`}
          />
          <Detail label="Entry" value={entry} />
          {tournament.registrationRequiresApproval ? (
            <Text style={styles.muted}>
              The organizer approves each registration.
            </Text>
          ) : null}
        </View>

        <ActionSection
          action={action}
          busy={busy}
          spotsLeft={spotsLeft}
          isPaid={isPaid}
          total={total}
          conventionName={convention?.name ?? null}
          eventUrl={webEventUrl(tournament.publicCode, inviteCode)}
          conventionUrl={
            convention ? webConventionUrl(convention.publicCode) : null
          }
          onRegister={() => void register()}
          onWithdraw={withdraw}
          onOpenEvent={onOpenEvent}
          onOpenWeb={(url) => void openOnWeb(url)}
        />
      </ScrollView>
      <Toast toast={toast} onDismiss={dismiss} />
    </SafeAreaView>
  );
}

function ActionSection({
  action,
  busy,
  spotsLeft,
  isPaid,
  total,
  conventionName,
  eventUrl,
  conventionUrl,
  onRegister,
  onWithdraw,
  onOpenEvent,
  onOpenWeb,
}: {
  action: JoinAction;
  busy: boolean;
  spotsLeft: number;
  isPaid: boolean;
  // The fee preview's total, once it loads.
  total: string | null;
  conventionName: string | null;
  // Null when the app has no web origin configured (lib/web-links.ts).
  eventUrl: string | null;
  conventionUrl: string | null;
  onRegister: () => void;
  onWithdraw: () => void;
  onOpenEvent?: () => void;
  onOpenWeb: (url: string) => void;
}) {
  const spots = spotsLeft === 1 ? "1 spot left" : `${spotsLeft} spots left`;
  const closedNote = (
    <Text style={styles.muted}>Registration is closed for this event.</Text>
  );
  const withdrawButton = (
    <Button
      label="Withdraw registration"
      variant="outline"
      busy={busy}
      onPress={onWithdraw}
    />
  );
  // Until in-app Checkout lands, payment happens on the web. The in-app
  // browser carries no session from the app, so the player signs in there.
  const payOnWeb = (label: string) =>
    eventUrl ? (
      <>
        <Button label={label} onPress={() => onOpenWeb(eventUrl)} />
        <Text style={styles.muted}>
          You’ll sign in again on the web to pay.
        </Text>
      </>
    ) : (
      <Text style={styles.muted}>
        Paying isn’t available in the app yet. Finish on the web.
      </Text>
    );

  switch (action.kind) {
    case "loading":
      return (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={palette.mutedForeground} />
          <Text style={styles.muted}>Checking your registration</Text>
        </View>
      );
    case "signIn":
      return (
        <View style={styles.section}>
          <SignInButton label="Sign in to register" />
          <Text style={styles.muted}>{spots}</Text>
        </View>
      );
    case "register":
      return (
        <View style={styles.section}>
          <Button
            label="Register for this event"
            busy={busy}
            onPress={onRegister}
          />
          <Text style={styles.muted}>
            {spots}
            {action.comped ? " · included with your convention badge" : ""}
          </Text>
        </View>
      );
    case "requestToRegister":
      return (
        <View style={styles.section}>
          <Button
            label="Request to register"
            busy={busy}
            onPress={onRegister}
          />
          <Text style={styles.muted}>
            {spots}
            {action.comped
              ? " · included with your convention badge"
              : isPaid && total
                ? ` · ${total} due after approval`
                : ""}
          </Text>
        </View>
      );
    case "pay":
      return (
        <View style={styles.section}>
          {payOnWeb(total ? `Pay ${total} on the web` : "Pay on the web")}
          <Text style={styles.muted}>{spots}</Text>
        </View>
      );
    case "completePayment":
      return (
        <View style={styles.section}>
          <Badge tone="outline">
            {action.purpose === "post_approval"
              ? "Application approved — payment required"
              : "Payment required to finish registering"}
          </Badge>
          {payOnWeb(total ? `Complete payment — ${total}` : "Complete payment")}
          {withdrawButton}
        </View>
      );
    case "pendingReview":
      return (
        <View style={styles.section}>
          <Badge tone="outline">Registration pending organizer approval</Badge>
          {action.canWithdraw ? withdrawButton : closedNote}
        </View>
      );
    case "waitlisted":
      return (
        <View style={styles.section}>
          <Badge tone="outline">You’re on the waitlist</Badge>
          {action.canWithdraw ? withdrawButton : closedNote}
        </View>
      );
    case "registered":
      return (
        <View style={styles.section}>
          <Badge>You’re registered</Badge>
          {onOpenEvent ? (
            <Button label="Open the event" onPress={onOpenEvent} />
          ) : null}
        </View>
      );
    case "rejected":
      return (
        <View style={styles.section}>
          <Badge tone="destructive">Your registration was declined</Badge>
        </View>
      );
    case "full":
      return (
        <View style={styles.section}>
          <Button
            label="Tournament is full"
            variant="outline"
            disabled
            onPress={() => {}}
          />
        </View>
      );
    case "closed":
      return <View style={styles.section}>{closedNote}</View>;
    case "badgeBlocked": {
      const name = conventionName ?? "convention";
      return (
        <View style={styles.section}>
          <Text style={styles.muted}>
            {action.reason === "missing"
              ? `This event requires a confirmed ${name} badge — register for the convention first.`
              : `Your ${name} badge does not cover this event’s date — upgrade your badge first.`}
          </Text>
          {conventionUrl ? (
            <Button
              label={`Open ${name} on the web`}
              variant="outline"
              onPress={() => onOpenWeb(conventionUrl)}
            />
          ) : null}
          {action.canWithdraw ? withdrawButton : null}
        </View>
      );
    }
  }
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detail}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue}>{value}</Text>
    </View>
  );
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: palette.background },
  content: { padding: 20, gap: 16 },
  card: {
    backgroundColor: palette.card,
    borderRadius: 14,
    padding: 16,
    gap: 10,
  },
  eyebrow: {
    color: palette.mutedForeground,
    fontSize: 13,
    fontWeight: "600",
  },
  title: { color: palette.foreground, fontSize: 22, fontWeight: "700" },
  detail: { gap: 2 },
  detailLabel: { color: palette.mutedForeground, fontSize: 13 },
  detailValue: { color: palette.foreground, fontSize: 16 },
  section: { gap: 12 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  muted: { color: palette.mutedForeground, fontSize: 15 },
});
