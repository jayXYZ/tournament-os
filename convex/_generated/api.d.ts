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
import type * as model_access from "../model/access.js";
import type * as model_pairing from "../model/pairing.js";
import type * as model_standings from "../model/standings.js";
import type * as model_testing from "../model/testing.js";
import type * as model_tournaments from "../model/tournaments.js";
import type * as model_users from "../model/users.js";
import type * as organizations from "../organizations.js";
import type * as tournaments_lifecycle from "../tournaments/lifecycle.js";
import type * as tournaments_registrations from "../tournaments/registrations.js";
import type * as tournaments_rounds from "../tournaments/rounds.js";
import type * as tournaments_testing from "../tournaments/testing.js";
import type * as users from "../users.js";
import type * as validators from "../validators.js";
import type * as workosApi from "../workosApi.js";
import type * as workosEvents from "../workosEvents.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  http: typeof http;
  "model/access": typeof model_access;
  "model/pairing": typeof model_pairing;
  "model/standings": typeof model_standings;
  "model/testing": typeof model_testing;
  "model/tournaments": typeof model_tournaments;
  "model/users": typeof model_users;
  organizations: typeof organizations;
  "tournaments/lifecycle": typeof tournaments_lifecycle;
  "tournaments/registrations": typeof tournaments_registrations;
  "tournaments/rounds": typeof tournaments_rounds;
  "tournaments/testing": typeof tournaments_testing;
  users: typeof users;
  validators: typeof validators;
  workosApi: typeof workosApi;
  workosEvents: typeof workosEvents;
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

export declare const components: {};
