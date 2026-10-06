// Fails when pnpm-lock.yaml resolves more than one version of a package that
// must exist exactly once in the workspace.
//
// Under `nodeLinker: hoisted` (pnpm-workspace.yaml) a second copy of React,
// React DOM, React Native, or Convex ends up as a nested node_modules that
// Metro and Vite load as a separate module, splitting React context (hooks,
// ConvexProvider lookups). The `overrides` block pins React, so this is the
// safety net that catches drift before it reaches a device.
//
// This replaces `pnpm dedupe --check`, which flagged harmless transitive
// duplicates (tough-cookie, lru-cache, ...) and corrupts a hoisted
// node_modules as a side effect. Add a package here only when two copies of
// it would be a bug, not merely untidy.
//
// Usage: node scripts/check-single-version.js [path/to/pnpm-lock.yaml]

const fs = require("node:fs");
const path = require("node:path");

const SINGLE_VERSION_PACKAGES = [
  "react",
  "react-dom",
  "react-native",
  "convex",
];

const lockfilePath = path.resolve(
  process.argv[2] ?? path.join(__dirname, "..", "pnpm-lock.yaml"),
);
const lockfile = fs.readFileSync(lockfilePath, "utf8");

// Only the `packages:` section lists each resolved package once per version;
// `snapshots:` repeats them per peer-dependency combination, which is not a
// duplicate install under the hoisted linker.
const packagesSection = lockfile.split(/^packages:\s*$/m)[1]?.split(/^\S/m)[0];
if (!packagesSection) {
  console.error(`No "packages:" section found in ${lockfilePath}`);
  process.exit(2);
}

// Entries look like `  react@19.2.3:` or `  '@scope/name@1.2.3':`.
const entry = /^  '?((?:@[^/\s']+\/)?[^@\s']+)@([^\s':]+)'?:/gm;
const versions = new Map(
  SINGLE_VERSION_PACKAGES.map((name) => [name, new Set()]),
);
for (const match of packagesSection.matchAll(entry)) {
  const [, name, version] = match;
  versions.get(name)?.add(version);
}

const failures = [...versions].filter(([, found]) => found.size > 1);
const missing = [...versions].filter(([, found]) => found.size === 0);

for (const [name] of missing) {
  console.warn(
    `warning: ${name} is not in the lockfile; drop it from SINGLE_VERSION_PACKAGES`,
  );
}
if (failures.length === 0) {
  console.log(
    `ok: one version each of ${SINGLE_VERSION_PACKAGES.filter((n) => versions.get(n).size === 1).join(", ")}`,
  );
  process.exit(0);
}
console.error(
  "Multiple versions of a single-copy package are in pnpm-lock.yaml:\n",
);
for (const [name, found] of failures) {
  console.error(`  ${name}: ${[...found].sort().join(", ")}`);
}
console.error(
  "\nPin the version in the `overrides` block of pnpm-workspace.yaml or run" +
    " `pnpm why <package>` to find who pulls in the extra copy, then `pnpm install`.",
);
process.exit(1);
