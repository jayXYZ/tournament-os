import { useEffect, useRef, useState } from 'react'

// Card-name suggestions for the decklist add bar, backed by Scryfall's
// autocomplete catalog for now — the plan of record is a customized index
// that also understands normalized/nicknamed forms, so keep this module the
// only place that knows where suggestions come from.

const AUTOCOMPLETE_URL = 'https://api.scryfall.com/cards/autocomplete'
// Scryfall ignores queries shorter than 2 characters.
const MIN_QUERY_LENGTH = 2
const DEBOUNCE_MS = 200

// Session-lifetime cache. Queries repeat constantly while a player types
// (every backspace replays a prefix), and the catalog is stable within a
// session, so cache hits both cut latency to zero and keep request volume
// polite.
const cache = new Map<string, Array<string>>()

export function useCardAutocomplete(query: string): {
  suggestions: Array<string>
  loading: boolean
} {
  const normalized = query.trim().toLowerCase()
  const tooShort = normalized.length < MIN_QUERY_LENGTH
  const cached = tooShort ? [] : cache.get(normalized)

  const [results, setResults] = useState<{
    query: string
    suggestions: Array<string>
  } | null>(null)
  const latestQuery = useRef(normalized)
  latestQuery.current = normalized

  useEffect(() => {
    if (tooShort || cache.has(normalized)) {
      return
    }
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(
          `${AUTOCOMPLETE_URL}?q=${encodeURIComponent(normalized)}`,
          { signal: controller.signal },
        )
        if (!response.ok) {
          throw new Error(`autocomplete request failed: ${response.status}`)
        }
        const body: unknown = await response.json()
        const suggestions = parseCatalog(body)
        cache.set(normalized, suggestions)
        if (latestQuery.current === normalized) {
          setResults({ query: normalized, suggestions })
        }
      } catch {
        // Suggestions are an accelerator, not a gate — on failure the add bar
        // still accepts the typed name verbatim. For that fallback to appear,
        // loading must resolve, so record an empty result in component state.
        // Deliberately skip the module cache: caching would pin a transient
        // outage as "no suggestions" for the whole session, whereas an
        // uncached failure lets any retype of the query retry the fetch.
        if (controller.signal.aborted) {
          // Cancelled by cleanup (newer keystroke or unmount), not a failure —
          // whatever replaced this effect owns the loading state now.
          return
        }
        if (latestQuery.current === normalized) {
          setResults({ query: normalized, suggestions: [] })
        }
      }
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [normalized, tooShort])

  if (tooShort) {
    return { suggestions: [], loading: false }
  }
  if (cached) {
    return { suggestions: cached, loading: false }
  }
  if (results && results.query === normalized) {
    return { suggestions: results.suggestions, loading: false }
  }
  return { suggestions: [], loading: true }
}

function parseCatalog(body: unknown): Array<string> {
  if (
    typeof body === 'object' &&
    body !== null &&
    'data' in body &&
    Array.isArray((body).data)
  ) {
    return (body as { data: Array<unknown> }).data.filter(
      (item): item is string => typeof item === 'string',
    )
  }
  return []
}
