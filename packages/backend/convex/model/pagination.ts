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
