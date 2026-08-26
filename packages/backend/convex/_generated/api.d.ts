/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as http from "../http.js";
import type * as maintenance from "../maintenance.js";
import type * as model_access from "../model/access.js";
import type * as model_auditLog from "../model/auditLog.js";
import type * as model_batching from "../model/batching.js";
import type * as model_cutoffs from "../model/cutoffs.js";
import type * as model_decklists from "../model/decklists.js";
import type * as model_deletion from "../model/deletion.js";
import type * as model_invites from "../model/invites.js";
import type * as model_matchResults from "../model/matchResults.js";
import type * as model_nextStep from "../model/nextStep.js";
import type * as model_pagination from "../model/pagination.js";
import type * as model_pairing from "../model/pairing.js";
import type * as model_participants from "../model/participants.js";
import type * as model_participation from "../model/participation.js";
import type * as model_payments from "../model/payments.js";
import type * as model_phases from "../model/phases.js";
import type * as model_playerResults from "../model/playerResults.js";
import type * as model_playerView from "../model/playerView.js";
import type * as model_progression from "../model/progression.js";
import type * as model_publicCodes from "../model/publicCodes.js";
import type * as model_random from "../model/random.js";
import type * as model_registrations from "../model/registrations.js";
import type * as model_roster from "../model/roster.js";
import type * as model_singleElimination from "../model/singleElimination.js";
import type * as model_standings from "../model/standings.js";
import type * as model_stripeAccounts from "../model/stripeAccounts.js";
import type * as model_testing from "../model/testing.js";
import type * as model_tournaments from "../model/tournaments.js";
import type * as model_users from "../model/users.js";
import type * as organizations from "../organizations.js";
import type * as payments_checkout from "../payments/checkout.js";
import type * as payments_connect from "../payments/connect.js";
import type * as payments_queries from "../payments/queries.js";
import type * as payments_refunds from "../payments/refunds.js";
import type * as payments_webhooks from "../payments/webhooks.js";
import type * as rateLimits from "../rateLimits.js";
import type * as specHelpers from "../specHelpers.js";
import type * as stripe_client from "../stripe/client.js";
import type * as stripe_config from "../stripe/config.js";
import type * as tournaments_auditLog from "../tournaments/auditLog.js";
import type * as tournaments_decklists from "../tournaments/decklists.js";
import type * as tournaments_invites from "../tournaments/invites.js";
import type * as tournaments_lifecycle from "../tournaments/lifecycle.js";
import type * as tournaments_player from "../tournaments/player.js";
import type * as tournaments_playerMeeting from "../tournaments/playerMeeting.js";
import type * as tournaments_registrations from "../tournaments/registrations.js";
import type * as tournaments_rounds from "../tournaments/rounds.js";
import type * as tournaments_testing from "../tournaments/testing.js";
import type * as tournaments_timer from "../tournaments/timer.js";
import type * as users from "../users.js";
import type * as validators from "../validators.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  http: typeof http;
  maintenance: typeof maintenance;
  "model/access": typeof model_access;
  "model/auditLog": typeof model_auditLog;
  "model/batching": typeof model_batching;
  "model/cutoffs": typeof model_cutoffs;
  "model/decklists": typeof model_decklists;
  "model/deletion": typeof model_deletion;
  "model/invites": typeof model_invites;
  "model/matchResults": typeof model_matchResults;
  "model/nextStep": typeof model_nextStep;
  "model/pagination": typeof model_pagination;
  "model/pairing": typeof model_pairing;
  "model/participants": typeof model_participants;
  "model/participation": typeof model_participation;
  "model/payments": typeof model_payments;
  "model/phases": typeof model_phases;
  "model/playerResults": typeof model_playerResults;
  "model/playerView": typeof model_playerView;
  "model/progression": typeof model_progression;
  "model/publicCodes": typeof model_publicCodes;
  "model/random": typeof model_random;
  "model/registrations": typeof model_registrations;
  "model/roster": typeof model_roster;
  "model/singleElimination": typeof model_singleElimination;
  "model/standings": typeof model_standings;
  "model/stripeAccounts": typeof model_stripeAccounts;
  "model/testing": typeof model_testing;
  "model/tournaments": typeof model_tournaments;
  "model/users": typeof model_users;
  organizations: typeof organizations;
  "payments/checkout": typeof payments_checkout;
  "payments/connect": typeof payments_connect;
  "payments/queries": typeof payments_queries;
  "payments/refunds": typeof payments_refunds;
  "payments/webhooks": typeof payments_webhooks;
  rateLimits: typeof rateLimits;
  specHelpers: typeof specHelpers;
  "stripe/client": typeof stripe_client;
  "stripe/config": typeof stripe_config;
  "tournaments/auditLog": typeof tournaments_auditLog;
  "tournaments/decklists": typeof tournaments_decklists;
  "tournaments/invites": typeof tournaments_invites;
  "tournaments/lifecycle": typeof tournaments_lifecycle;
  "tournaments/player": typeof tournaments_player;
  "tournaments/playerMeeting": typeof tournaments_playerMeeting;
  "tournaments/registrations": typeof tournaments_registrations;
  "tournaments/rounds": typeof tournaments_rounds;
  "tournaments/testing": typeof tournaments_testing;
  "tournaments/timer": typeof tournaments_timer;
  users: typeof users;
  validators: typeof validators;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  rateLimiter: import("@convex-dev/rate-limiter/_generated/component.js").ComponentApi<"rateLimiter">;
};
