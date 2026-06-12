import type {
  OrganizerInviteRole,
  OrganizerRole,
} from "@tournament-os/core/organizer-utils";

const WORKOS_API_BASE_URL = "https://api.workos.com";

type WorkosObject = Record<string, unknown>;

function workosApiKey() {
  const apiKey = process.env.WORKOS_API_KEY;
  if (!apiKey) {
    throw new Error("WORKOS_API_KEY is not configured");
  }

  return apiKey;
}

async function workosRequest<T>(
  path: string,
  body: WorkosObject,
  method: "POST" | "PUT" = "POST",
) {
  const response = await fetch(`${WORKOS_API_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${workosApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = (await response.json()) as WorkosObject;

  if (!response.ok) {
    const message =
      typeof json.message === "string"
        ? json.message
        : `WorkOS request failed with status ${response.status}`;
    throw new Error(message);
  }

  return json as T;
}

export type WorkosOrganization = {
  id: string;
  name: string;
};

export type WorkosMembership = {
  id: string;
  user_id?: string;
  userId?: string;
  organization_id?: string;
  organizationId?: string;
  role?: { slug?: string };
  roles?: Array<{ slug?: string }>;
  status?: string;
};

export type WorkosInvitation = {
  id: string;
  email: string;
  organization_id?: string;
  organizationId?: string;
  role_slug?: string;
  roleSlug?: string;
  state?: string;
  status?: string;
};

export async function createWorkosOrganization(name: string) {
  const response = await workosRequest<WorkosObject>("/organizations", { name });
  return extractWorkosOrganization(response);
}

export async function updateWorkosOrganization(args: {
  organizationId: string;
  name: string;
}) {
  const response = await workosRequest<WorkosObject>(
    `/organizations/${args.organizationId}`,
    { name: args.name },
    "PUT",
  );
  return extractWorkosOrganization(response);
}

export async function createWorkosOrganizationMembership(args: {
  organizationId: string;
  userId: string;
  roleSlug: OrganizerRole;
}) {
  let response: WorkosObject;
  try {
    response = await workosRequest<WorkosObject>(
      "/user_management/organization_memberships",
      buildWorkosMembershipPayload(args),
    );
  } catch (error) {
    if (!isInvalidWorkosRoleError(error)) {
      throw error;
    }

    console.warn(
      `WorkOS role "${args.roleSlug}" is not configured. Retrying membership creation with the WorkOS default role.`,
    );
    response = await workosRequest<WorkosObject>(
      "/user_management/organization_memberships",
      buildWorkosMembershipPayload({ ...args, roleSlug: null }),
    );
  }

  return extractWorkosMembership(response);
}

export async function sendWorkosInvitation(args: {
  organizationId: string;
  email: string;
  roleSlug: OrganizerInviteRole;
  inviterUserId: string;
}) {
  const response = await workosRequest<WorkosObject>(
    "/user_management/invitations",
    {
      email: args.email,
      organization_id: args.organizationId,
      role_slug: args.roleSlug,
      inviter_user_id: args.inviterUserId,
    },
  );

  return extractWorkosInvitation(response);
}

export function extractWorkosOrganization(
  response: WorkosObject,
): WorkosOrganization {
  const candidate = objectField(response, "organization") ?? response;
  const id = stringField(candidate, "id");
  const name = stringField(candidate, "name");

  if (!id) {
    throw new Error("WorkOS organization response did not include an organization id");
  }

  if (!name) {
    throw new Error("WorkOS organization response did not include an organization name");
  }

  return { id, name };
}

export function buildWorkosMembershipPayload(args: {
  organizationId: string;
  userId: string;
  roleSlug: OrganizerRole | null;
}): WorkosObject {
  return {
    organization_id: args.organizationId,
    user_id: args.userId,
    ...(args.roleSlug ? { role_slug: args.roleSlug } : {}),
  };
}

export function buildWorkosOrganizationUpdatePayload(args: {
  organizationId: string;
  name: string;
}) {
  return {
    organization: args.organizationId,
    name: args.name,
  };
}

export function isInvalidWorkosRoleError(error: unknown) {
  return (
    error instanceof Error &&
    error.message.trim().toLowerCase() === "the role is invalid."
  );
}

export function extractWorkosMembership(response: WorkosObject): WorkosMembership {
  const candidate = objectField(response, "organization_membership") ?? response;
  const id = stringField(candidate, "id");

  if (!id) {
    throw new Error("WorkOS membership response did not include a membership id");
  }

  return candidate as WorkosMembership;
}

export function extractWorkosInvitation(response: WorkosObject): WorkosInvitation {
  const candidate = objectField(response, "invitation") ?? response;
  const id = stringField(candidate, "id");
  const email = stringField(candidate, "email");

  if (!id) {
    throw new Error("WorkOS invitation response did not include an invitation id");
  }

  if (!email) {
    throw new Error("WorkOS invitation response did not include an email");
  }

  return candidate as WorkosInvitation;
}

function objectField(object: WorkosObject, field: string): WorkosObject | null {
  const value = object[field];
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as WorkosObject;
  }

  return null;
}

function stringField(object: WorkosObject, field: string): string | null {
  const value = object[field];
  return typeof value === "string" && value.length > 0 ? value : null;
}
