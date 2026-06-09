import type { ReactNode } from "react";

import { WorkspaceNotice } from "@/app/components/organizer-workspace/notice-context";

export default function AdminViewsLayout({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="p-4 sm:p-6 lg:p-8">
      <div className="mx-auto grid max-w-6xl gap-6">
        <WorkspaceNotice />
        {children}
      </div>
    </div>
  );
}
