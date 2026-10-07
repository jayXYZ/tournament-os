// paginationOptsValidator accepts every Convex number — including NaN and the
// infinities — so clamp a client-supplied page size before it controls how
// many rows a query reads (and how many receive per-row enrichment). Finite
// requests floor into [1, max]; non-finite requests get the minimum rather
// than a guess at intent.
export function clampPageSize(requested: number, max: number): number {
  if (!Number.isFinite(requested)) {
    return 1;
  }
  return Math.min(max, Math.max(1, Math.floor(requested)));
}

// The guideline-conformant counterpart to clampPageSize: paginationOpts must
// reach `.paginate()` unchanged (rebuilding it drops the optional fields'
// native behaviour), so instead of rewriting an oversized or non-finite page
// size the query refuses it. Page sizes come from our own clients, so a
// refusal is a build mistake surfacing, never a user path.
export function requirePageSize(requested: number, max: number): void {
  if (!Number.isFinite(requested) || requested < 1 || requested > max) {
    throw new Error(`Page size must be between 1 and ${max}`);
  }
}

// Shared ceiling for the organizer-facing admin list pages (audit log,
// registrations): the same shape of per-tournament history list, so the same
// cap.
export const ORGANIZER_LIST_PAGE_SIZE = 100;
