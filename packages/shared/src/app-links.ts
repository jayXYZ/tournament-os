// Recognizes the links and codes the native app can act on: what a QR scan
// or a typed code hands the scanner, and where it should go. Today the only
// kind is a join code (CONTEXT.md "Join QR"); new QR kinds join the union.
//
// This only decides whether the text looks like one of ours and pulls the
// code out. It never says which kind of code it found and never validates
// the alphabet: resolveJoinCode on the server tells a Public Code from an
// Invite Link code and stays the one authority on both. Nothing here opens
// the scanned URL either, so there's no host allow-list: a lookalike domain
// gets as far as a code lookup against our own backend.
export type AppLink = { kind: "join"; code: string };

// The two join-code lengths: a Public Code is 6 characters, an Invite Link
// code 10 (PUBLIC_CODE_LENGTH and INVITE_CODE_LENGTH in the backend's
// model/publicCodes.ts and model/invites.ts; joinCodes.convex.spec.ts pins
// that they match).
export const JOIN_CODE_LENGTHS = [6, 10] as const;

// `…/join/<code>` on any http(s) host, with an optional trailing slash,
// query, or fragment.
const WEB_JOIN_URL = /^https?:\/\/[^/?#\s]+\/join\/([^/?#]+)\/?(?:[?#].*)?$/i;
// `paperpairings://join/<code>`, the form expo-router's scheme links take,
// and the empty-host `paperpairings:///join/<code>` spelling of the same path.
const APP_JOIN_URL = /^paperpairings:\/\/\/?join\/([^/?#]+)\/?(?:[?#].*)?$/i;

// Strips the separators people type or print (spaces and dashes, as in the
// dashed `XXXXX-XXXXX` invite code), then accepts 6 or 10 letters and digits.
// The result is uppercased only so a typed code reads the same in the URL as
// a printed one; the server's normalizer still maps lookalike characters.
function joinCode(raw: string): string | null {
  const code = raw.replace(/[\s-]/g, "").toUpperCase();
  return /^[0-9A-Z]+$/.test(code) &&
    (JOIN_CODE_LENGTHS as readonly number[]).includes(code.length)
    ? code
    : null;
}

export function parseAppLink(raw: string): AppLink | null {
  const text = raw.trim();
  const match = WEB_JOIN_URL.exec(text) ?? APP_JOIN_URL.exec(text);
  let segment = text;
  if (match) {
    try {
      segment = decodeURIComponent(match[1]);
    } catch {
      return null;
    }
  } else if (text.includes("/") || text.includes(":")) {
    // Some other URL: not ours, even if its last segment looks like a code.
    return null;
  }
  const code = joinCode(segment);
  return code === null ? null : { kind: "join", code };
}
