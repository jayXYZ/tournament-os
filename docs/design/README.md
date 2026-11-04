# Web design conventions

The web design foundation is on `main` through PRs #32, #33, and #34. This
page records the existing composition patterns and the checks expected when
extending them. It does not certify an accessibility or deployment audit.

`figma-overhaul-ledger.json` maps design artifacts to Figma nodes and records
design completion on 2026-09-16. `name-explorations.html` is exploration work.
Neither file is a release checklist. Open work lives in [roadmap section
10](../../TODO.md#10-design-system-and-platform-polish).

## Tokens and theme

`apps/web/src/styles/app.css` owns the semantic tokens. It uses Radix gray
for neutrals, iris for the accent, red for destructive states, Geist for text,
and Geist Mono for monospace content. Radius and elevation scales also live
there. Prefer these tokens and the shared UI components over adding page-local
colors, shadows, or control styles.

`ThemeProvider` supports light, dark, and system preferences and applies the
theme before hydration. Check both themes when changing a component, including
menus/dialogs rendered through portals. Some animations already handle reduced
motion; a common motion policy and an audit of all interactions remain open.

## Page composition

| Need                 | Existing implementation                                           | Convention                                                                                                                                                 |
| -------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page alignment       | `shared/page-column.ts`                                           | Use `pageColumnClasses` for the header, content, subnav, and fixed bars. Put narrower reading content inside that frame with `readingColumnClasses`.       |
| Player-facing chrome | `shared/site-shell.tsx`                                           | Use `SiteShell` for the public header, optional phone app bar, bottom bar, and content clearance. Web safe-area support remains open in roadmap section 8. |
| Workspace structure  | `shared/workspace-page-header.tsx`, `shared/workspace-subnav.tsx` | Reuse the header/action and navigation patterns across tournament, convention, and organization views.                                                     |
| Sections             | `shared/section-stack.tsx`, `shared/section-header.tsx`           | Stack sections with shared spacing and dividers; use the heading/description/action component for their titles.                                            |
| Tables and filtering | `ui/data-table.tsx`, `ui/data-table-toolbar.tsx`                  | Reuse search/filter controls and pagination. Filters must describe the full server result set, including rows not loaded yet.                              |
| Results and status   | `shared/status-dot.tsx`, tournament display and result components | Pair visual state with readable labels. Player-reported results already count; never imply an opponent must confirm them.                                  |

Paths in this table are relative to `apps/web/src/components/`.

## Accessibility and responsive review

Before closing a workflow's audit, record the revision and tested routes,
themes, and viewports in [delivery status](../delivery-status.md). Check:

- Keyboard access, visible focus, sensible focus order, dialog focus return,
  and controls that remain reachable in narrow layouts.
- Accessible names for icon buttons and inputs, heading structure, and
  screen-reader announcements for errors and changing results.
- Contrast in both themes, status information that does not rely on color,
  readable zoomed text, and usable touch targets.
- Reduced-motion behavior, long names, empty/loading/error states, and content
  clearance around fixed bars in portrait and landscape.

Existing focus-ring utilities and shared controls help implement these checks;
they do not replace testing the composed workflows. Native design and device
verification remain separately tracked in roadmap section 8.
