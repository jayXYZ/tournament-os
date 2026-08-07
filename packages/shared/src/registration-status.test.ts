import { expect, test } from "vitest";

import {
  DELETED_REGISTRATION_STATUS,
  MALFORMED_REGISTRATION_STATUS,
  effectiveRegistrationStatus,
} from "./registration-status.ts";

test("entry workflow states pass through untouched", () => {
  expect(effectiveRegistrationStatus({ entryStatus: "pending" })).toBe(
    "pending",
  );
  expect(effectiveRegistrationStatus({ entryStatus: "waitlisted" })).toBe(
    "waitlisted",
  );
  expect(effectiveRegistrationStatus({ entryStatus: "cancelled" })).toBe(
    "cancelled",
  );
  expect(effectiveRegistrationStatus({ entryStatus: "rejected" })).toBe(
    "rejected",
  );
});

test("a confirmed entry collapses to its participation status", () => {
  expect(
    effectiveRegistrationStatus({
      entryStatus: "confirmed",
      participationStatus: "active",
    }),
  ).toBe("active");
  expect(
    effectiveRegistrationStatus({
      entryStatus: "confirmed",
      participationStatus: "dropped",
    }),
  ).toBe("dropped");
  expect(
    effectiveRegistrationStatus({
      entryStatus: "confirmed",
      participationStatus: "disqualified",
    }),
  ).toBe("disqualified");
  expect(
    effectiveRegistrationStatus({
      entryStatus: "confirmed",
      participationStatus: "eliminated",
    }),
  ).toBe("eliminated");
});

test("a non-confirmed entry ignores any participation status", () => {
  expect(
    effectiveRegistrationStatus({
      entryStatus: "pending",
      participationStatus: "active",
    }),
  ).toBe("pending");
  expect(
    effectiveRegistrationStatus({
      entryStatus: "cancelled",
      participationStatus: "dropped",
    }),
  ).toBe("cancelled");
});

test("a confirmed entry without a participation status gets the malformed label", () => {
  expect(effectiveRegistrationStatus({ entryStatus: "confirmed" })).toBe(
    MALFORMED_REGISTRATION_STATUS,
  );
  expect(
    effectiveRegistrationStatus({
      entryStatus: "confirmed",
      participationStatus: null,
    }),
  ).toBe(MALFORMED_REGISTRATION_STATUS);
});

test("the malformed and deleted labels stay distinct", () => {
  // Callers must not conflate a corrupt row with a deleted one; the two
  // constants existing as different strings is what keeps that possible.
  expect(MALFORMED_REGISTRATION_STATUS).not.toBe(DELETED_REGISTRATION_STATUS);
});
