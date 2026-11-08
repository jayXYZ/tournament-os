import {
  initialScanState,
  rearmScan,
  restartScanWindow,
  scanIntake,
} from "@paper-pairings/shared/scan-intake";
import type { ScanInput } from "@paper-pairings/shared/scan-intake";
import { CameraView, useCameraPermissions } from "expo-camera";
import type {
  BarcodeScanningResult,
  BarcodeSettings,
  PermissionResponse,
} from "expo-camera";
import * as Haptics from "expo-haptics";
import { useFocusEffect, useIsFocused, useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  ActivityIndicator,
  AppState,
  KeyboardAvoidingView,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button } from "@/components/button";
import { Toast, useToast } from "@/components/toast";
import { palette } from "@/lib/palette";

// /scan: the player's QR scanner, presented full screen over home
// (_layout.tsx). A Join QR (CONTEXT.md "Join QR") opens the join screen for
// its code; any other QR code gets a toast and is never opened, so a poster
// pointing somewhere else can't send anyone there. The camera and "Type a
// code instead" go through one intake (@paper-pairings/shared/scan-intake),
// so typing a code on a simulator exercises the decision a scan makes on a
// phone.

const NOT_OURS = "Not a Paper Pairings code";

// Module-level so CameraView never sees a new settings object on render.
const QR_ONLY: BarcodeSettings = { barcodeTypes: ["qr"] };

// The camera runs only while the app is in front. "inactive" counts as away
// too: iOS reports it while a system sheet (the camera prompt, Control
// Center, the app switcher) covers the app.
function subscribeToAppState(onChange: () => void) {
  const subscription = AppState.addEventListener("change", onChange);
  return () => subscription.remove();
}
const appIsActive = () =>
  AppState.currentState !== "background" &&
  AppState.currentState !== "inactive";

export default function ScanScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { toast, show, dismiss } = useToast();
  const [permission, requestPermission, refreshPermission] =
    useCameraPermissions();

  // The scan lock and repeat window (scan-intake.ts). The state lives in a
  // ref because the camera reports a code on every frame it is in view;
  // `locked` mirrors the lock so the camera stops reporting at all
  // (onBarcodeScanned is left unset) while it holds.
  const scan = useRef(initialScanState);
  const [locked, setLocked] = useState(false);

  // Backing out of the screen a code opened lands here again: re-arm. The
  // camera mounts on this same render and starts a moment later, so
  // onCameraReady restarts the repeat window again (restartScanWindow).
  useFocusEffect(
    useCallback(() => {
      scan.current = rearmScan(scan.current, Date.now());
      setLocked(false);
    }, []),
  );

  // Pushing the join screen leaves this screen mounted underneath, and a
  // mounted CameraView keeps the camera session (and the torch) running, so
  // the camera is rendered only while this screen is focused and the app is
  // in front, as Expo's camera docs require.
  const focused = useIsFocused();
  const appActive = useSyncExternalStore(subscribeToAppState, appIsActive);
  const granted = permission?.granted === true;
  const cameraLive = granted && focused && appActive;

  // The torch goes off whenever the camera does, on blur or in the
  // background, rather than coming back on with it.
  const [torchOn, setTorchOn] = useState(false);
  if (torchOn && !cameraLive) {
    setTorchOn(false);
  }
  const [cameraFailed, setCameraFailed] = useState(false);

  // Camera access granted in Settings takes effect when the player returns.
  useEffect(() => {
    if (appActive) {
      void refreshPermission();
    }
  }, [appActive, refreshPermission]);

  const intake = useCallback(
    (input: ScanInput) => {
      const { state, outcome } = scanIntake(scan.current, input, Date.now());
      scan.current = state;
      if (outcome.kind === "ignored") {
        return false;
      }
      if (outcome.kind === "notOurs") {
        show(NOT_OURS, "destructive");
        return false;
      }
      setLocked(true);
      if (input.source === "camera") {
        Haptics.notificationAsync(
          Haptics.NotificationFeedbackType.Success,
        ).catch(() => {});
      }
      router.push({
        pathname: "/join/[code]",
        params: { code: outcome.link.code },
      });
      return true;
    },
    [router, show],
  );

  const onBarcodeScanned = useCallback(
    ({ data }: BarcodeScanningResult) => {
      intake({ source: "camera", text: data });
    },
    [intake],
  );

  const close = () => {
    if (router.canGoBack()) {
      router.back();
    } else {
      router.replace("/");
    }
  };

  return (
    <View style={styles.screen}>
      {cameraLive ? (
        <CameraView
          style={StyleSheet.absoluteFill}
          facing="back"
          barcodeScannerSettings={QR_ONLY}
          onBarcodeScanned={locked ? undefined : onBarcodeScanned}
          enableTorch={torchOn}
          onCameraReady={() => {
            setCameraFailed(false);
            scan.current = restartScanWindow(scan.current, Date.now());
          }}
          onMountError={() => setCameraFailed(true)}
        />
      ) : null}

      <View style={[styles.body, { paddingTop: insets.top + 64 }]}>
        {permission === null ? (
          <ActivityIndicator color={palette.mutedForeground} />
        ) : granted ? (
          <Viewfinder failed={cameraFailed} />
        ) : (
          <PermissionPrompt
            permission={permission}
            onRequest={() => void requestPermission()}
          />
        )}
      </View>

      <View style={[styles.topBar, { paddingTop: insets.top + 8 }]}>
        <IconButton
          label="Close"
          ios="xmark"
          android="close"
          fallback="Close"
          onPress={close}
        />
        {cameraLive && !cameraFailed ? (
          <IconButton
            label={torchOn ? "Turn off flashlight" : "Turn on flashlight"}
            ios={torchOn ? "flashlight.on.fill" : "flashlight.off.fill"}
            android={torchOn ? "flashlight_on" : "flashlight_off"}
            fallback={torchOn ? "Light off" : "Light"}
            selected={torchOn}
            onPress={() => setTorchOn((on) => !on)}
          />
        ) : null}
      </View>

      {/* "padding" on Android too: the app draws edge to edge, so the
          window is not resized for the keyboard (adjustResize) and the
          typed-code field would sit under it. */}
      <KeyboardAvoidingView behavior="padding" style={styles.bottom}>
        <TypedCode
          bottomInset={insets.bottom}
          onSubmit={(text) => intake({ source: "typed", text })}
        />
      </KeyboardAvoidingView>

      <View
        pointerEvents="box-none"
        style={[styles.toastArea, { top: insets.top + 56 }]}
      >
        <Toast toast={toast} onDismiss={dismiss} />
      </View>
    </View>
  );
}

function Viewfinder({ failed }: { failed: boolean }) {
  return (
    <View style={styles.viewfinderArea}>
      <View style={styles.viewfinder}>
        <View style={[styles.corner, styles.topLeft]} />
        <View style={[styles.corner, styles.topRight]} />
        <View style={[styles.corner, styles.bottomLeft]} />
        <View style={[styles.corner, styles.bottomRight]} />
      </View>
      <Text style={styles.caption}>
        {failed
          ? "The camera couldn’t start. Type the code instead."
          : "Point the camera at the event’s QR code"}
      </Text>
    </View>
  );
}

// Before the system prompt, say what the camera is for; once the player has
// said no (and the system won't ask again), only Settings can turn it on.
function PermissionPrompt({
  permission,
  onRequest,
}: {
  permission: PermissionResponse;
  onRequest: () => void;
}) {
  const blocked = !permission.canAskAgain;
  return (
    <View style={styles.prompt}>
      <Text style={styles.promptTitle}>
        {blocked ? "Camera access is off" : "Scan an event’s QR code"}
      </Text>
      <Text style={styles.promptBody}>
        {blocked
          ? "To scan QR codes, turn on camera access for Paper Pairings in Settings."
          : "Paper Pairings uses the camera to read tournament QR codes."}
      </Text>
      <Button
        label={blocked ? "Open Settings" : "Allow camera"}
        onPress={blocked ? () => void Linking.openSettings() : onRequest}
        style={styles.promptButton}
      />
    </View>
  );
}

// "Type a code instead": the code off a poster, a dashed invite code, or a
// pasted join link. The text goes through the same intake as a scan, and
// the server's normalizer has the last word on the code.
function TypedCode({
  bottomInset,
  onSubmit,
}: {
  bottomInset: number;
  onSubmit: (text: string) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");

  const submit = () => {
    if (text.trim() === "") {
      return;
    }
    // A code that opened is cleared, so backing out shows an empty field;
    // one that didn't stays for the player to fix.
    if (onSubmit(text)) {
      setText("");
    }
  };

  if (!open) {
    return (
      <View style={[styles.panel, { paddingBottom: bottomInset + 16 }]}>
        <Button
          label="Type a code instead"
          variant="outline"
          onPress={() => setOpen(true)}
        />
      </View>
    );
  }
  return (
    <View style={[styles.panel, { paddingBottom: bottomInset + 16 }]}>
      <TextInput
        testID="scan-code-input"
        accessibilityLabel="Event code"
        style={styles.input}
        value={text}
        onChangeText={setText}
        onSubmitEditing={submit}
        placeholder="Event code"
        placeholderTextColor={palette.mutedForeground}
        autoFocus
        autoCapitalize="characters"
        autoCorrect={false}
        autoComplete="off"
        spellCheck={false}
        returnKeyType="go"
      />
      <Button label="Continue" onPress={submit} />
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          setOpen(false);
          setText("");
        }}
        style={({ pressed }) => [styles.textButton, pressed && styles.pressed]}
      >
        <Text style={styles.textButtonLabel}>Scan instead</Text>
      </Pressable>
    </View>
  );
}

function IconButton({
  label,
  ios,
  android,
  fallback,
  selected = false,
  onPress,
}: {
  label: string;
  ios: "xmark" | "flashlight.on.fill" | "flashlight.off.fill";
  android: "close" | "flashlight_on" | "flashlight_off";
  fallback: string;
  selected?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      hitSlop={8}
      onPress={onPress}
      style={({ pressed }) => [
        styles.iconButton,
        selected && styles.iconButtonSelected,
        pressed && styles.pressed,
      ]}
    >
      <SymbolView
        name={{ ios, android }}
        size={20}
        tintColor={selected ? palette.primaryForeground : palette.foreground}
        fallback={<Text style={styles.iconFallback}>{fallback}</Text>}
      />
    </Pressable>
  );
}

const CORNER = 28;
const CORNER_WIDTH = 4;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: "#000" },
  body: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0, 0, 0, 0.55)",
  },
  iconButtonSelected: { backgroundColor: palette.primary },
  iconFallback: { color: palette.foreground, fontSize: 12, fontWeight: "600" },
  pressed: { opacity: 0.8 },
  viewfinderArea: { alignItems: "center", gap: 24, marginBottom: 120 },
  viewfinder: { width: 248, height: 248 },
  corner: {
    position: "absolute",
    width: CORNER,
    height: CORNER,
    borderColor: palette.foreground,
  },
  topLeft: {
    top: 0,
    left: 0,
    borderTopWidth: CORNER_WIDTH,
    borderLeftWidth: CORNER_WIDTH,
    borderTopLeftRadius: 12,
  },
  topRight: {
    top: 0,
    right: 0,
    borderTopWidth: CORNER_WIDTH,
    borderRightWidth: CORNER_WIDTH,
    borderTopRightRadius: 12,
  },
  bottomLeft: {
    bottom: 0,
    left: 0,
    borderBottomWidth: CORNER_WIDTH,
    borderLeftWidth: CORNER_WIDTH,
    borderBottomLeftRadius: 12,
  },
  bottomRight: {
    bottom: 0,
    right: 0,
    borderBottomWidth: CORNER_WIDTH,
    borderRightWidth: CORNER_WIDTH,
    borderBottomRightRadius: 12,
  },
  caption: {
    color: palette.foreground,
    fontSize: 15,
    fontWeight: "600",
    textAlign: "center",
    textShadowColor: "rgba(0, 0, 0, 0.6)",
    textShadowRadius: 6,
  },
  prompt: { alignSelf: "stretch", gap: 12, marginBottom: 120 },
  promptTitle: { color: palette.foreground, fontSize: 22, fontWeight: "700" },
  promptBody: { color: palette.mutedForeground, fontSize: 15 },
  promptButton: { marginTop: 8 },
  bottom: { position: "absolute", left: 0, right: 0, bottom: 0 },
  panel: {
    gap: 12,
    paddingTop: 16,
    paddingHorizontal: 20,
    backgroundColor: "rgba(0, 0, 0, 0.55)",
  },
  input: {
    color: palette.foreground,
    fontSize: 18,
    letterSpacing: 2,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.card,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  textButton: { alignSelf: "center", paddingVertical: 6 },
  textButtonLabel: { color: palette.mutedForeground, fontSize: 15 },
  toastArea: { position: "absolute", left: 0, right: 0, bottom: 0 },
});
