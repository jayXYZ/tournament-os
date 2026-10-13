// Pages the app hands off to the web until it can do the job itself:
// paying an entry fee (until in-app Checkout lands) and a convention's page.
// The origin is optional configuration; without it the hand-off buttons are
// left out rather than pointing somewhere wrong.
const webOrigin = process.env.EXPO_PUBLIC_WEB_ORIGIN?.replace(/\/+$/, "");

export function webUrl(path: string): string | null {
  return webOrigin ? `${webOrigin}${path}` : null;
}

// The web event page, opened with the invite code when the player came in
// through a private event's Invite Link (the same URL /join/<code> forwards
// to on the web).
export function webEventUrl(publicCode: string, inviteCode?: string) {
  const query = inviteCode ? `?invite=${encodeURIComponent(inviteCode)}` : "";
  return webUrl(`/tournaments/${encodeURIComponent(publicCode)}${query}`);
}

export function webConventionUrl(publicCode: string) {
  return webUrl(`/conventions/${encodeURIComponent(publicCode)}`);
}
