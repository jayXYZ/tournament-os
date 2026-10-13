import { useClientClock as useSharedClientClock } from "@paper-pairings/core";
import type { ClientClockOptions, SubscribeToWake } from "@paper-pairings/core";
import { AppState } from "react-native";

// Timers don't run while the app is suspended, so the clock re-reads the
// time each time the app comes back to the foreground.
const subscribeToAppActive: SubscribeToWake = (refresh) => {
  const subscription = AppState.addEventListener("change", (state) => {
    if (state === "active") {
      refresh();
    }
  });
  return () => subscription.remove();
};

// Native's binding of the shared client clock (see @paper-pairings/core
// client-clock.ts) to AppState.
export function useClientClock(options: ClientClockOptions = {}) {
  return useSharedClientClock({
    ...options,
    subscribeToWake: subscribeToAppActive,
  });
}
