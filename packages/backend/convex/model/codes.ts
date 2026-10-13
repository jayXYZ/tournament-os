// The random codes people read, type, and scan: an event's Public Code (see
// model/publicCodes.ts) and a tournament's Invite Link code (model/invites.ts).
// Both share one alphabet and one normalizer and differ only in length, which
// is how /join/<code> tells them apart (tournaments/invites.ts
// resolveJoinCode).

// Crockford base32: no I, L, O, or U, so a code read aloud or off a phone
// screen has no lookalike ambiguity — normalizeCode maps the excluded letters
// back onto the digits they resemble. 32 characters also divide 256 evenly, so
// sampling bytes modulo the alphabet is unbiased.
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateCode(length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(
    bytes,
    (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length],
  ).join("");
}

// Parses a code as it arrives from a URL or a keyboard: case-insensitive,
// separator-tolerant, and forgiving of the lookalike characters the alphabet
// excludes. Returns the canonical stored form, or null for anything that
// still isn't `length` characters of the alphabet — callers treat unknown and
// malformed codes identically.
export function normalizeCode(value: string, length: number): string | null {
  const normalized = value
    .toUpperCase()
    .replace(/[\s-]/g, "")
    .replace(/O/g, "0")
    .replace(/[IL]/g, "1");
  return normalized.length === length &&
    [...normalized].every((char) => CODE_ALPHABET.includes(char))
    ? normalized
    : null;
}

// Mints a code no existing row holds, as `isTaken` reports. Five attempts is
// plenty: with a million events, a 6-character public code collides about
// once in a thousand draws, so all five colliding is about 1 in 10^15.
export async function mintUniqueCode(
  length: number,
  isTaken: (code: string) => Promise<boolean>,
): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateCode(length);
    if (!(await isTaken(code))) {
      return code;
    }
  }
  throw new Error("Could not generate a unique code");
}
