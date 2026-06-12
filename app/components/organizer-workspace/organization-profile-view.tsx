"use client";

import { useState, type FormEvent } from "react";
import { useAction, useMutation } from "convex/react";
import { Archive, Building2 } from "lucide-react";
import { toast } from "sonner";

import { api } from "@tournament-os/backend/convex/_generated/api";
import type { Id } from "@tournament-os/backend/convex/_generated/dataModel";
import {
  validateOrganizationProfileImageDetails,
  type OrganizationProfileImageDetails,
} from "@tournament-os/core/organization-profile-image";
import { canManageOrganizationProfile } from "@tournament-os/core/organizer-utils";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useOrganization } from "./organization-context";

type ProfileBusy = "profile" | "profileImage" | "archive" | null;

export function OrganizationProfileView() {
  const { selectedOrganization, clearSelectedOrganization } = useOrganization();

  const generateProfileImageUploadUrl = useMutation(
    api.organizations.generateProfileImageUploadUrl,
  );
  const updateProfileImage = useMutation(api.organizations.updateProfileImage);
  const updateProfile = useAction(api.organizations.updateProfile);
  const archiveOrganization = useMutation(
    api.organizations.archiveOrganization,
  );

  const organization = selectedOrganization?.organization ?? null;
  const membershipRole = selectedOrganization?.membership.role ?? null;
  const mayManageProfile = membershipRole
    ? canManageOrganizationProfile(membershipRole)
    : false;
  const organizationId = organization?._id ?? null;

  const [busy, setBusy] = useState<ProfileBusy>(null);
  const [profileName, setProfileName] = useState(organization?.name ?? "");
  const [archiveConfirmationName, setArchiveConfirmationName] = useState("");

  // Reset the draft when the selected organization changes, using React's
  // "adjust state during render" pattern instead of an effect.
  const [draftOrganizationId, setDraftOrganizationId] = useState(organizationId);
  if (organizationId !== draftOrganizationId) {
    setDraftOrganizationId(organizationId);
    setProfileName(organization?.name ?? "");
    setArchiveConfirmationName("");
  }

  async function handleUpdateProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) {
      return;
    }

    setBusy("profile");
    try {
      await updateProfile({ organizationId, name: profileName });
      toast.success("Organization profile updated.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not update organization profile.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleUpdateProfileImage(file: File) {
    if (!organizationId) {
      return;
    }

    setBusy("profileImage");
    try {
      const dimensions = await readImageDimensions(file);
      const validationMessage = validateOrganizationProfileImageDetails({
        type: file.type,
        size: file.size,
        ...dimensions,
      });
      if (validationMessage) {
        throw new Error(validationMessage);
      }

      const uploadUrl = await generateProfileImageUploadUrl({ organizationId });
      const response = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!response.ok) {
        throw new Error("Could not upload profile picture.");
      }

      const { storageId } = (await response.json()) as {
        storageId: Id<"_storage">;
      };
      await updateProfileImage({
        organizationId,
        profileImageStorageId: storageId,
      });
      toast.success("Organization profile picture updated.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not update organization profile picture.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleArchiveOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!organizationId) {
      return;
    }

    setBusy("archive");
    try {
      await archiveOrganization({
        organizationId,
        confirmationName: archiveConfirmationName,
      });
      clearSelectedOrganization();
      setArchiveConfirmationName("");
      toast.success("Organization archived.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Could not archive organization.",
      );
    } finally {
      setBusy(null);
    }
  }

  if (!organization) {
    return <Skeleton className="h-72" />;
  }

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {membershipRole ?? "No org"}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-normal">
            Organization profile
          </h1>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
            <CardDescription>
              Update the selected organization workspace profile.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleUpdateProfile}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="profile-organization-name">
                    Name
                  </FieldLabel>
                  <Input
                    id="profile-organization-name"
                    value={profileName}
                    onChange={(event) => setProfileName(event.target.value)}
                    disabled={!mayManageProfile || busy === "profile"}
                    required
                  />
                </Field>
                <Button
                  type="submit"
                  disabled={!mayManageProfile || busy === "profile"}
                >
                  {busy === "profile" ? (
                    <Spinner data-icon="inline-start" />
                  ) : null}
                  Save changes
                </Button>
                {!mayManageProfile && (
                  <FieldDescription>
                    Only owners and admins can update organization details.
                  </FieldDescription>
                )}
              </FieldGroup>
            </form>
          </CardContent>
        </Card>

        <aside className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Profile picture</CardTitle>
              <CardDescription>PNG, JPEG, or WebP up to 2 MB.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div
                className="flex size-28 items-center justify-center overflow-hidden rounded-md border border-border bg-muted bg-cover bg-center"
                style={
                  organization.profileImageUrl
                    ? { backgroundImage: `url(${organization.profileImageUrl})` }
                    : undefined
                }
              >
                {!organization.profileImageUrl && (
                  <Building2 className="text-muted-foreground" />
                )}
              </div>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="profile-image">Upload image</FieldLabel>
                  <Input
                    id="profile-image"
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    disabled={!mayManageProfile || busy === "profileImage"}
                    onChange={(event) => {
                      const file = event.target.files?.[0];
                      if (file) {
                        void handleUpdateProfileImage(file);
                      }
                      event.target.value = "";
                    }}
                  />
                  <FieldDescription>
                    Use a square image at least 256 x 256 pixels.
                  </FieldDescription>
                </Field>
                {busy === "profileImage" && (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Spinner data-icon="inline-start" />
                    Uploading profile picture
                  </p>
                )}
              </FieldGroup>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Archive organization</CardTitle>
              <CardDescription>
                Archive hides this workspace without deleting historical data.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleArchiveOrganization}>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="archive-confirmation">
                      Type {organization.name}
                    </FieldLabel>
                    <Input
                      id="archive-confirmation"
                      value={archiveConfirmationName}
                      onChange={(event) =>
                        setArchiveConfirmationName(event.target.value)
                      }
                      disabled={!mayManageProfile || busy === "archive"}
                    />
                  </Field>
                  <Button
                    type="submit"
                    variant="destructive"
                    disabled={!mayManageProfile || busy === "archive"}
                  >
                    {busy === "archive" ? (
                      <Spinner data-icon="inline-start" />
                    ) : (
                      <Archive data-icon="inline-start" />
                    )}
                    Archive organization
                  </Button>
                </FieldGroup>
              </form>
            </CardContent>
          </Card>
        </aside>
      </div>
    </section>
  );
}

function readImageDimensions(file: File) {
  return new Promise<Pick<OrganizationProfileImageDetails, "width" | "height">>(
    (resolve, reject) => {
      const image = new Image();
      const objectUrl = URL.createObjectURL(file);

      image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        resolve({ width: image.naturalWidth, height: image.naturalHeight });
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("Could not read profile picture dimensions."));
      };
      image.src = objectUrl;
    },
  );
}
