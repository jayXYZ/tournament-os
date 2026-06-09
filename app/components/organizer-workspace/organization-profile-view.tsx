import type { FormEvent } from "react";
import { Archive, Building2 } from "lucide-react";

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
import type {
  BusyState,
  MemberRole,
  OrganizationWithProfileImage,
} from "./types";

export function OrganizationProfileView({
  archiveConfirmationName,
  busy,
  mayManageProfile,
  membershipRole,
  onArchiveConfirmationNameChange,
  onArchiveOrganization,
  onProfileImageChange,
  onProfileNameChange,
  onUpdateProfile,
  organization,
  profileName,
}: {
  archiveConfirmationName: string;
  busy: BusyState;
  mayManageProfile: boolean;
  membershipRole: MemberRole | null;
  onArchiveConfirmationNameChange: (value: string) => void;
  onArchiveOrganization: (event: FormEvent<HTMLFormElement>) => void;
  onProfileImageChange: (file: File) => void;
  onProfileNameChange: (value: string) => void;
  onUpdateProfile: (event: FormEvent<HTMLFormElement>) => void;
  organization: OrganizationWithProfileImage | null;
  profileName: string;
}) {
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
            <form onSubmit={onUpdateProfile}>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="profile-organization-name">
                    Name
                  </FieldLabel>
                  <Input
                    id="profile-organization-name"
                    value={profileName}
                    onChange={(event) => onProfileNameChange(event.target.value)}
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
                        onProfileImageChange(file);
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
              <form onSubmit={onArchiveOrganization}>
                <FieldGroup>
                  <Field>
                    <FieldLabel htmlFor="archive-confirmation">
                      Type {organization.name}
                    </FieldLabel>
                    <Input
                      id="archive-confirmation"
                      value={archiveConfirmationName}
                      onChange={(event) =>
                        onArchiveConfirmationNameChange(event.target.value)
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
