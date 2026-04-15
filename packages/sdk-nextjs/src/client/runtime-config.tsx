"use client";

import {
  createContext,
  useContext,
  type ReactNode,
} from "react";

export type RuntimeConfigPrimitive = string | number | boolean | null;
export type RuntimeConfigRecord = Record<
  string,
  RuntimeConfigPrimitive | undefined
>;

const RuntimeConfigContext = createContext<RuntimeConfigRecord | null>(null);

let browserRuntimeConfig: RuntimeConfigRecord | null = null;

export function RuntimeConfigProvider<T extends RuntimeConfigRecord>({
  config,
  children,
}: {
  config: T;
  children: ReactNode;
}) {
  if (typeof window !== "undefined") {
    browserRuntimeConfig = config;
  }

  return (
    <RuntimeConfigContext.Provider value={config}>
      {children}
    </RuntimeConfigContext.Provider>
  );
}

export function useRuntimeConfig<T extends RuntimeConfigRecord>(): T {
  const config = useContext(RuntimeConfigContext);
  if (!config) {
    throw new Error(
      "useRuntimeConfig must be used within a RuntimeConfigProvider",
    );
  }

  return config as T;
}

export function getRuntimeConfig<T extends RuntimeConfigRecord>(): T {
  if (!browserRuntimeConfig) {
    throw new Error(
      "Runtime config unavailable. Wrap the app in RuntimeConfigProvider before calling getRuntimeConfig().",
    );
  }

  return browserRuntimeConfig as T;
}

export function resetRuntimeConfigForTests(): void {
  browserRuntimeConfig = null;
}

export function setRuntimeConfigForTests<T extends RuntimeConfigRecord>(
  config: T,
): void {
  browserRuntimeConfig = config;
}
