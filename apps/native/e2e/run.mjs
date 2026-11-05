#!/usr/bin/env node
// Runs the native join and scanner E2E (Maestro flows in ./flows) on a
// booted iOS simulator: seeds one fresh set of events on the personal dev
// Convex deployment, serves sign-in tickets for the test player and the
// newcomer, and hands both to `maestro test`. Prerequisites and usage:
// apps/native/README.md, "Device E2E (Maestro)".
//
//   pnpm --filter @paper-pairings/native e2e:ios            # every flow
//   pnpm --filter @paper-pairings/native e2e:ios 03-paid.yaml
//
// Secrets stay in this process: CLERK_SECRET_KEY mints tickets here and only
// single-use, five-minute tickets reach Maestro. Invite codes are passed to
// Maestro but never printed.
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);

const e2eDir = path.dirname(fileURLToPath(import.meta.url));
const nativeDir = path.resolve(e2eDir, "..");
const repoRoot = path.resolve(nativeDir, "../..");
const backendDir = path.join(repoRoot, "packages/backend");
const flowsDir = path.join(e2eDir, "flows");
const convexBin = path.join(repoRoot, "node_modules/.bin/convex");

// The dev client's own scheme, `exp+<slug>` (app.config.ts slug).
const DEV_CLIENT_SCHEME = "exp+paper-pairings-native";
const PLAYER_EMAIL = "e2e-native-player@example.com";
// A second player who is never registered for anything, so home shows its
// empty state (the scanner's call to action there). The main player can't:
// every run registers them for events that stay upcoming.
const NEWCOMER_EMAIL = "e2e-native-newcomer@example.com";
const DAY = 24 * 60 * 60 * 1000;

function readEnvFile(file) {
  if (!existsSync(file)) {
    return {};
  }
  const values = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) {
      values[match[1]] = match[2].replace(/^(['"])(.*)\1$/, "$2");
    }
  }
  return values;
}

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

// --- Configuration ---------------------------------------------------------

const webEnv = readEnvFile(path.join(repoRoot, "apps/web/.env.local"));
const nativeEnv = readEnvFile(path.join(nativeDir, ".env.local"));
const backendEnv = readEnvFile(path.join(backendDir, ".env.local"));

const clerkSecretKey = process.env.CLERK_SECRET_KEY ?? webEnv.CLERK_SECRET_KEY;
if (!clerkSecretKey?.startsWith("sk_test_")) {
  fail(
    "CLERK_SECRET_KEY (apps/web/.env.local) must be a development-instance key (sk_test_…).",
  );
}

// The deployment comes from packages/backend/.env.local and is pinned for
// every CLI call below, so neither a shell CONVEX_DEPLOYMENT nor a deploy
// key can point the seed anywhere else.
const deployment = backendEnv.CONVEX_DEPLOYMENT?.split("#")[0].trim();
if (!deployment?.startsWith("dev:")) {
  fail(
    "packages/backend/.env.local must set CONVEX_DEPLOYMENT to a dev deployment (dev:…).",
  );
}
const convexEnv = { ...process.env, CONVEX_DEPLOYMENT: deployment };
delete convexEnv.CONVEX_DEPLOY_KEY;
delete convexEnv.CONVEX_SELF_HOSTED_URL;

// Metro inlines EXPO_PUBLIC_WEB_ORIGIN from the same sources, so the paid
// flows know which hand-off the join screen shows.
const webOrigin =
  process.env.EXPO_PUBLIC_WEB_ORIGIN ?? nativeEnv.EXPO_PUBLIC_WEB_ORIGIN ?? "";
const metroUrl = process.env.E2E_METRO_URL ?? "http://127.0.0.1:8081";

function maestroCommand() {
  if (process.env.MAESTRO_BIN) {
    return process.env.MAESTRO_BIN;
  }
  const local = path.join(os.homedir(), ".maestro/bin/maestro");
  return existsSync(local) ? local : "maestro";
}

// Maestro needs Java 17+. Fall back to a JDK unpacked under ~/.maestro/jdk.
function javaHome() {
  if (process.env.JAVA_HOME) {
    return process.env.JAVA_HOME;
  }
  const jdkRoot = path.join(os.homedir(), ".maestro/jdk");
  if (!existsSync(jdkRoot)) {
    return undefined;
  }
  for (const entry of readdirSync(jdkRoot)) {
    const home = path.join(jdkRoot, entry, "Contents/Home");
    if (existsSync(path.join(home, "bin/java"))) {
      return home;
    }
  }
  return undefined;
}

async function bootedSimulator() {
  if (process.env.E2E_DEVICE) {
    return process.env.E2E_DEVICE;
  }
  const { stdout } = await run("xcrun", [
    "simctl",
    "list",
    "devices",
    "booted",
    "-j",
  ]);
  const booted = Object.values(JSON.parse(stdout).devices)
    .flat()
    .find((device) => device.state === "Booted");
  if (!booted) {
    fail(
      "No booted iOS simulator. Boot one (xcrun simctl boot <udid>) with the dev client installed.",
    );
  }
  return booted.udid;
}

// --- Clerk -----------------------------------------------------------------

async function clerk(method, pathname, body) {
  const response = await fetch(`https://api.clerk.com/v1${pathname}`, {
    method,
    headers: {
      Authorization: `Bearer ${clerkSecretKey}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(
      `Clerk ${method} ${pathname} answered ${response.status}: ${await response.text()}`,
    );
  }
  return await response.json();
}

async function findOrCreateUser(email, lastName) {
  const found = await clerk(
    "GET",
    `/users?email_address=${encodeURIComponent(email)}`,
  );
  if (found.length > 0) {
    return found[0];
  }
  return await clerk("POST", "/users", {
    email_address: [email],
    first_name: "E2E",
    last_name: lastName,
    skip_password_requirement: true,
  });
}

// One fresh ticket per request, for the flows' sign-in subflow
// (flows/subflows/mint-ticket.js): `/ticket` for the player,
// `/ticket/newcomer` for the newcomer. Bound to loopback; Maestro's script
// engine runs on this machine, not in the simulator.
async function startTicketServer(userIds) {
  const server = http.createServer((request, response) => {
    const userId =
      request.method === "POST"
        ? { "/ticket": userIds.player, "/ticket/newcomer": userIds.newcomer }[
            request.url
          ]
        : undefined;
    if (!userId) {
      response.writeHead(404).end();
      return;
    }
    clerk("POST", "/sign_in_tokens", {
      user_id: userId,
      expires_in_seconds: 300,
    }).then(
      ({ token }) => {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ticket: token }));
      },
      (error) => {
        console.error(`Ticket mint failed: ${error.message}`);
        response.writeHead(502).end();
      },
    );
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

// --- Convex ----------------------------------------------------------------

async function convex(functionName, args, identity) {
  const { stdout } = await run(
    convexBin,
    [
      "run",
      "--typecheck",
      "disable",
      "--codegen",
      "disable",
      ...(identity ? ["--identity", JSON.stringify(identity)] : []),
      functionName,
      JSON.stringify(args),
    ],
    { cwd: backendDir, env: convexEnv, maxBuffer: 16 * 1024 * 1024 },
  );
  const output = stdout.trim();
  return output === "" ? null : JSON.parse(output);
}

async function convexInlineQuery(source) {
  const { stdout } = await run(
    convexBin,
    [
      "run",
      "--typecheck",
      "disable",
      "--codegen",
      "disable",
      "--inline-query",
      source,
    ],
    { cwd: backendDir, env: convexEnv, maxBuffer: 16 * 1024 * 1024 },
  );
  return JSON.parse(stdout.trim());
}

// Runs the task factories at most `limit` at a time.
async function inParallel(tasks, limit = 6) {
  const results = new Array(tasks.length);
  let next = 0;
  const workers = Array.from({ length: limit }, async () => {
    while (next < tasks.length) {
      const index = next++;
      results[index] = await tasks[index]();
    }
  });
  await Promise.all(workers);
  return results;
}

// Seeds one run's events under a fresh organizer and organization, through
// the public mutations, except the payouts-ready Stripe stand-in paid
// events need (devSeed.ts). Returns the Maestro environment.
async function seed(player) {
  const issuer = (
    await run(convexBin, ["env", "get", "CLERK_JWT_ISSUER_DOMAIN"], {
      cwd: backendDir,
      env: convexEnv,
    })
  ).stdout.trim();
  const runId = randomBytes(4).toString("hex");
  const organizerIssuer = "https://e2e-native.invalid";
  const organizer = {
    subject: `organizer-${runId}`,
    issuer: organizerIssuer,
    tokenIdentifier: `${organizerIssuer}|organizer-${runId}`,
    email: `e2e-native-organizer-${runId}@example.test`,
    name: "E2E Native Organizer",
  };
  // The identity the app's Clerk session carries into Convex.
  const playerIdentity = {
    subject: player.id,
    issuer,
    tokenIdentifier: `${issuer}|${player.id}`,
    email: PLAYER_EMAIL,
    emailVerified: true,
    name: "E2E Native Player",
  };
  const asOrganizer = (fn, args) => convex(fn, args, organizer);
  const asPlayer = (fn, args) => convex(fn, args, playerIdentity);

  const { organizationId } = await asOrganizer(
    "organizations:createOrganizerOrganization",
    { name: `E2E Native Join ${runId}` },
  );
  await convex("devSeed:markOrganizationPayoutsReady", { organizationId });

  const startDate =
    Math.ceil((Date.now() + 14 * DAY) / (60 * 60 * 1000)) * 60 * 60 * 1000;
  const conventionStart = startDate + 14 * DAY;
  const phases = [{ phaseOrder: 1, phaseRoundMode: "dynamic" }];

  // Applies setup, visibility, and publication to a created tournament.
  async function configure(tournamentId, options) {
    const setup = {};
    if (options.approval) setup.registrationRequiresApproval = true;
    if (options.feeCents) setup.entryFeeCents = options.feeCents;
    if (Object.keys(setup).length > 0) {
      await asOrganizer("tournaments/lifecycle:updateTournamentSetup", {
        tournamentId,
        ...setup,
      });
    }
    // Private before publication, so the event is never public.
    if (options.visibility && options.visibility !== "public") {
      await asOrganizer("tournaments/lifecycle:updateTournamentVisibility", {
        tournamentId,
        visibility: options.visibility,
      });
    }
    if (options.publish !== false) {
      await asOrganizer("tournaments/lifecycle:publishTournament", {
        tournamentId,
      });
    }
    return tournamentId;
  }

  async function event(name, options = {}) {
    const tournamentId = await asOrganizer(
      "tournaments/lifecycle:createTournamentWithPhases",
      {
        organizationId,
        name,
        startDate,
        playerCapacity: options.capacity ?? 8,
        format: "modern",
        phases,
      },
    );
    return await configure(tournamentId, options);
  }

  const fill = async (tournamentId, count) => {
    for (let n = 1; n <= count; n++) {
      await asOrganizer("tournaments/registrations:addGuest", {
        tournamentId,
        displayName: `E2E Guest ${n}`,
      });
    }
  };

  const ids = {};
  const invites = {};
  await inParallel([
    async () => (ids.free = await event("E2E Free Event")),
    async () =>
      (ids.approval = await event("E2E Approval Event", { approval: true })),
    async () => (ids.paid = await event("E2E Paid Event", { feeCents: 1500 })),
    async () =>
      (ids.paidApproval = await event("E2E Paid Approval Event", {
        feeCents: 1500,
        approval: true,
      })),
    async () =>
      (ids.unlisted = await event("E2E Unlisted Event", {
        visibility: "unlisted",
      })),
    async () => {
      ids.wentPrivate = await event("E2E Went Private Event");
      await asOrganizer("tournaments/lifecycle:updateTournamentVisibility", {
        tournamentId: ids.wentPrivate,
        visibility: "private",
      });
    },
    async () => {
      ids.private = await event("E2E Private Event", {
        visibility: "private",
      });
      invites.private = await asOrganizer(
        "tournaments/invites:createInviteLink",
        { tournamentId: ids.private },
      );
    },
    async () => {
      const tournamentId = await event("E2E Rotated Invite Event", {
        visibility: "private",
      });
      invites.rotatedOld = await asOrganizer(
        "tournaments/invites:createInviteLink",
        { tournamentId },
      );
      invites.rotatedNew = await asOrganizer(
        "tournaments/invites:regenerateInviteLink",
        { tournamentId },
      );
    },
    async () => {
      const tournamentId = await event("E2E Disabled Invite Event", {
        visibility: "private",
      });
      invites.disabled = await asOrganizer(
        "tournaments/invites:createInviteLink",
        { tournamentId },
      );
      await asOrganizer("tournaments/invites:disableInviteLink", {
        tournamentId,
      });
    },
    async () => {
      ids.setup = await event("E2E Setup Event", { publish: false });
      invites.setup = await asOrganizer(
        "tournaments/invites:createInviteLink",
        { tournamentId: ids.setup },
      );
    },
    async () => {
      ids.full = await event("E2E Full Event", { capacity: 2 });
      await fill(ids.full, 2);
    },
    async () => {
      ids.approvalFull = await event("E2E Approval Full Event", {
        capacity: 2,
        approval: true,
      });
      await fill(ids.approvalFull, 2);
    },
    async () => {
      ids.registered = await event("E2E Registered Event");
      await asPlayer("tournaments/registrations:registerSelf", {
        tournamentId: ids.registered,
      });
    },
    // A paid child event the convention's free pass includes, and a player
    // holding that pass: the badge comps the entry fee.
    async () => {
      const conventionId = await asOrganizer(
        "conventions/lifecycle:createConvention",
        {
          organizationId,
          name: "E2E Comp Convention",
          startDate: conventionStart,
          endDate: conventionStart + 2 * DAY,
          playerCapacity: 50,
        },
      );
      ids.comped = await asOrganizer(
        "conventions/events:createTournamentForConvention",
        {
          conventionId,
          name: "E2E Comped Event",
          startDate: conventionStart + 2 * 60 * 60 * 1000,
          playerCapacity: 8,
          format: "modern",
          phases,
        },
      );
      await configure(ids.comped, { feeCents: 1500 });
      const [pass] = await asOrganizer(
        "conventions/ticketTypes:listTicketTypesForOrganizer",
        { conventionId, now: Date.now() },
      );
      await asOrganizer("conventions/ticketTypes:updateTicketType", {
        ticketTypeId: pass._id,
        name: pass.name,
        priceCents: 0,
        includedTournamentIds: [ids.comped],
      });
      await asOrganizer("conventions/lifecycle:publishConvention", {
        conventionId,
      });
      await asPlayer("conventions/registrations:registerSelfForConvention", {
        conventionId,
        ticketTypeId: pass._id,
      });
    },
    // A child event of a convention that requires a badge, which the player
    // does not hold.
    async () => {
      const conventionId = await asOrganizer(
        "conventions/lifecycle:createConvention",
        {
          organizationId,
          name: "E2E Badge Convention",
          startDate: conventionStart,
          endDate: conventionStart + 2 * DAY,
          playerCapacity: 50,
        },
      );
      await asOrganizer("conventions/lifecycle:updateConventionSetup", {
        conventionId,
        badgeRequiredForChildEvents: true,
      });
      ids.gated = await asOrganizer(
        "conventions/events:createTournamentForConvention",
        {
          conventionId,
          name: "E2E Gated Event",
          startDate: conventionStart + 2 * 60 * 60 * 1000,
          playerCapacity: 8,
          format: "modern",
          phases,
        },
      );
      await configure(ids.gated, {});
      await asOrganizer("conventions/lifecycle:publishConvention", {
        conventionId,
      });
    },
  ]);

  const codes = await convexInlineQuery(
    `const ids = ${JSON.stringify(ids)};
     const codes = {};
     for (const [key, id] of Object.entries(ids)) {
       codes[key] = (await ctx.db.get(id)).publicCode;
     }
     return codes;`,
  );

  console.log(`Seeded run ${runId} (organization "E2E Native Join ${runId}"):`);
  for (const [key, code] of Object.entries(codes)) {
    console.log(`  ${key.padEnd(14)} ${code}`);
  }

  return {
    CODE_FREE: codes.free,
    CODE_FREE_TYPED: codes.free.toLowerCase(),
    CODE_APPROVAL: codes.approval,
    CODE_PAID: codes.paid,
    CODE_PAID_APPROVAL: codes.paidApproval,
    CODE_COMPED: codes.comped,
    CODE_GATED: codes.gated,
    CODE_UNLISTED: codes.unlisted,
    CODE_WENT_PRIVATE: codes.wentPrivate,
    CODE_PRIVATE: codes.private,
    INVITE_PRIVATE: invites.private,
    INVITE_ROTATED_OLD: invites.rotatedOld,
    INVITE_ROTATED_NEW: invites.rotatedNew,
    INVITE_DISABLED: invites.disabled,
    CODE_SETUP: codes.setup,
    INVITE_SETUP: invites.setup,
    CODE_FULL: codes.full,
    CODE_APPROVAL_FULL: codes.approvalFull,
    CODE_REGISTERED: codes.registered,
  };
}

// --- Main ------------------------------------------------------------------

async function main() {
  const flowArgs = process.argv.slice(2);
  const flows =
    flowArgs.length === 0
      ? [flowsDir]
      : flowArgs.map((flow) =>
          path.isAbsolute(flow) || existsSync(flow)
            ? path.resolve(flow)
            : path.join(flowsDir, flow),
        );

  const metro = await fetch(`${metroUrl}/status`).then(
    (response) => response.text(),
    () => "",
  );
  if (!metro.includes("packager-status:running")) {
    fail(
      `Metro is not running at ${metroUrl}. Start it with \`pnpm dev:native\` first.`,
    );
  }
  const device = await bootedSimulator();

  console.log(`Seeding Convex deployment ${deployment}…`);
  const player = await findOrCreateUser(PLAYER_EMAIL, "Native Player");
  const newcomer = await findOrCreateUser(NEWCOMER_EMAIL, "Native Newcomer");
  const env = await seed(player);
  const ticketServer = await startTicketServer({
    player: player.id,
    newcomer: newcomer.id,
  });
  const { port } = ticketServer.address();

  const maestroEnv = {
    ...env,
    TICKET_URL: `http://127.0.0.1:${port}/ticket`,
    NEWCOMER_TICKET_URL: `http://127.0.0.1:${port}/ticket/newcomer`,
    // The camera permission every launch sets (flows/subflows/launch.yaml);
    // the scanner's permission flow overrides it.
    CAMERA_PERMISSION: "allow",
    WEB_ORIGIN: webOrigin,
    DEV_CLIENT_URL: `${DEV_CLIENT_SCHEME}://expo-development-client/?url=${encodeURIComponent(metroUrl)}`,
  };

  console.log(
    `Running Maestro on ${device} (web origin ${webOrigin || "unset"})…`,
  );
  const java = javaHome();
  const exitCode = await new Promise((resolve) => {
    const child = spawn(
      maestroCommand(),
      [
        "--device",
        device,
        "test",
        ...Object.entries(maestroEnv).flatMap(([key, value]) => [
          "-e",
          `${key}=${value}`,
        ]),
        ...flows,
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          ...(java ? { JAVA_HOME: java } : {}),
          MAESTRO_CLI_NO_ANALYTICS: "1",
          MAESTRO_CLI_ANALYSIS_NOTIFICATION_DISABLED: "true",
        },
      },
    );
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", (error) => {
      console.error(`Could not start Maestro: ${error.message}`);
      resolve(1);
    });
  });
  ticketServer.close();
  process.exit(exitCode);
}

await main().catch((error) => fail(error.stack ?? String(error)));
