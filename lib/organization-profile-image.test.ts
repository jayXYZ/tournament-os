import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_ORGANIZATION_PROFILE_IMAGE_BYTES,
  MIN_ORGANIZATION_PROFILE_IMAGE_DIMENSION,
  ORGANIZATION_PROFILE_IMAGE_TYPES,
  validateOrganizationProfileImageDetails,
} from "./organization-profile-image.ts";

test("organization profile image constants expose the accepted constraints", () => {
  assert.deepEqual(ORGANIZATION_PROFILE_IMAGE_TYPES, [
    "image/png",
    "image/jpeg",
    "image/webp",
  ]);
  assert.equal(MAX_ORGANIZATION_PROFILE_IMAGE_BYTES, 2 * 1024 * 1024);
  assert.equal(MIN_ORGANIZATION_PROFILE_IMAGE_DIMENSION, 256);
});

test("validateOrganizationProfileImageDetails accepts supported square-enough images", () => {
  assert.equal(
    validateOrganizationProfileImageDetails({
      type: "image/png",
      size: 120_000,
      width: 512,
      height: 512,
    }),
    null,
  );
});

test("validateOrganizationProfileImageDetails rejects unsupported types", () => {
  assert.equal(
    validateOrganizationProfileImageDetails({
      type: "image/gif",
      size: 120_000,
      width: 512,
      height: 512,
    }),
    "Upload a PNG, JPEG, or WebP image.",
  );
});

test("validateOrganizationProfileImageDetails rejects oversized files", () => {
  assert.equal(
    validateOrganizationProfileImageDetails({
      type: "image/jpeg",
      size: MAX_ORGANIZATION_PROFILE_IMAGE_BYTES + 1,
      width: 512,
      height: 512,
    }),
    "Profile pictures must be 2 MB or smaller.",
  );
});

test("validateOrganizationProfileImageDetails rejects images below the minimum dimensions", () => {
  assert.equal(
    validateOrganizationProfileImageDetails({
      type: "image/webp",
      size: 120_000,
      width: 255,
      height: 512,
    }),
    "Profile pictures must be at least 256 x 256 pixels.",
  );
});
