"use client";

// shadcn's SidebarProvider persists toggles to this cookie but never reads
// it back; we read it here to restore the sidebar state across navigations
// and reloads. Safe to call client-side only (workspaces mount behind
// <Authenticated>, which renders nothing during SSR).
const SIDEBAR_COOKIE_NAME = "sidebar_state";

export function getStoredSidebarOpen(): boolean {
  if (typeof document === "undefined") {
    return true;
  }

  const match = document.cookie.match(
    new RegExp(`(?:^|; )${SIDEBAR_COOKIE_NAME}=([^;]*)`),
  );
  return match ? match[1] === "true" : true;
}
