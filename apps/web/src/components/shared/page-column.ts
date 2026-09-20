// The one horizontal page column for the whole web app. Every rail that draws
// a centered column — the public site header, SiteShell's content column and
// its phone app/bottom bars, the admin views, subnav and progress bar — renders
// exactly these classes, so page content and chrome line up at the same
// offset on every route and at every breakpoint. There is deliberately no
// width token to choose from: a page that reads better narrow constrains its
// own content inside this column (see `readingColumnClasses`), never the
// frame.
export const pageColumnClasses = 'mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8'

// An inner column for text-heavy pages (settings, profile, payment, invite,
// event details). It sits inside `pageColumnClasses`, so the gutters and the
// header rail stay identical to every other page while the content itself
// keeps a comfortable reading width.
export const readingColumnClasses = 'mx-auto w-full max-w-4xl'
