export const ORGANIZATION_PROFILE_IMAGE_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
] as const;

export const MAX_ORGANIZATION_PROFILE_IMAGE_BYTES = 2 * 1024 * 1024;
export const MIN_ORGANIZATION_PROFILE_IMAGE_DIMENSION = 256;

export type OrganizationProfileImageType =
  (typeof ORGANIZATION_PROFILE_IMAGE_TYPES)[number];

export type OrganizationProfileImageDetails = {
  type?: string;
  size: number;
  width?: number;
  height?: number;
};

export function isOrganizationProfileImageType(
  type: string | undefined,
): type is OrganizationProfileImageType {
  return ORGANIZATION_PROFILE_IMAGE_TYPES.includes(
    type as OrganizationProfileImageType,
  );
}

export function validateOrganizationProfileImageDetails(
  details: OrganizationProfileImageDetails,
) {
  if (!isOrganizationProfileImageType(details.type)) {
    return "Upload a PNG, JPEG, or WebP image.";
  }

  if (details.size > MAX_ORGANIZATION_PROFILE_IMAGE_BYTES) {
    return "Profile pictures must be 2 MB or smaller.";
  }

  if (
    typeof details.width === "number" &&
    typeof details.height === "number" &&
    (details.width < MIN_ORGANIZATION_PROFILE_IMAGE_DIMENSION ||
      details.height < MIN_ORGANIZATION_PROFILE_IMAGE_DIMENSION)
  ) {
    return "Profile pictures must be at least 256 x 256 pixels.";
  }

  return null;
}
