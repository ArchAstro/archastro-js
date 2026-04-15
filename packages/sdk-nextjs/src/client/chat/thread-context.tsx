"use client";

import { createContext, useContext, useState, useCallback } from "react";
import type { ThreadAction } from "@archastro/sdk";

export interface ThreadHeaderState {
  threadId: string;
  teamId?: string;
  isConnected: boolean;
  connectionError: string | null;
  headerActions: ThreadAction[];
}

interface ThreadHeaderContextValue {
  state: ThreadHeaderState | null;
  setThreadHeader: (state: ThreadHeaderState) => void;
  clearThreadHeader: () => void;
}

const ThreadHeaderContext = createContext<ThreadHeaderContextValue>({
  state: null,
  setThreadHeader: () => {},
  clearThreadHeader: () => {},
});

export function ThreadHeaderProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [state, setState] = useState<ThreadHeaderState | null>(null);

  const setThreadHeader = useCallback((next: ThreadHeaderState) => {
    setState(next);
  }, []);

  const clearThreadHeader = useCallback(() => {
    setState(null);
  }, []);

  return (
    <ThreadHeaderContext.Provider
      value={{ state, setThreadHeader, clearThreadHeader }}
    >
      {children}
    </ThreadHeaderContext.Provider>
  );
}

export function useThreadHeader() {
  return useContext(ThreadHeaderContext);
}
