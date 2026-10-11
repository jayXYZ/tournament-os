import {
  createFileRoute,
  lazyRouteComponent,
  notFound,
} from '@tanstack/react-router'

/**
 * Dev-only swatch sheet for the Radix Themes restyle: every primitive in
 * every variant and size, in both themes, side by side. The gallery itself
 * lives in `-dev-theme-sheet.tsx` (the `-` keeps it out of the route tree)
 * behind an `import.meta.env.DEV` conditional, so a production build drops
 * the import and never emits its chunk; what remains is this stub, which
 * 404s before it renders anything.
 */
export const Route = createFileRoute('/dev/theme')({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound()
  },
  component: import.meta.env.DEV
    ? lazyRouteComponent(() => import('./-dev-theme-sheet'), 'ThemeSheet')
    : undefined,
})
