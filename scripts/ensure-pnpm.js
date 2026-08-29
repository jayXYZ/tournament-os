// Preinstall guard: refuse installs from npm/yarn/bun so the pnpm lockfile
// and workspace resolution stay authoritative. Dependency-free on purpose —
// preinstall runs before anything is installed, and non-interactive npx
// (Node 24 / npm 10+) cancels instead of fetching a missing package, which
// broke `npx only-allow pnpm` in CI.
const userAgent = process.env.npm_config_user_agent ?? "";
if (!userAgent.startsWith("pnpm/")) {
  console.error("This repository uses pnpm — run `pnpm install` instead.");
  process.exit(1);
}
