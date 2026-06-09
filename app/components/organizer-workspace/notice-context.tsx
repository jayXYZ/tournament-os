"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { CheckCircle2 } from "lucide-react";

type NoticeContextValue = {
  notice: string | null;
  setNotice: (message: string | null) => void;
};

const NoticeContext = createContext<NoticeContextValue | null>(null);

export function NoticeProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<string | null>(null);

  const value = useMemo<NoticeContextValue>(
    () => ({ notice, setNotice }),
    [notice],
  );

  return (
    <NoticeContext.Provider value={value}>{children}</NoticeContext.Provider>
  );
}

export function useNotice() {
  const context = useContext(NoticeContext);
  if (!context) {
    throw new Error("useNotice must be used within a NoticeProvider");
  }
  return context;
}

export function useSetNotice() {
  return useNotice().setNotice;
}

export function WorkspaceNotice() {
  const { notice } = useNotice();
  if (!notice) {
    return null;
  }

  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2 text-sm text-foreground">
      <CheckCircle2 className="size-4 text-muted-foreground" />
      {notice}
    </div>
  );
}
