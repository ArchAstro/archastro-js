import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  RuntimeConfigProvider,
  getRuntimeConfig,
  resetRuntimeConfigForTests,
  useRuntimeConfig,
} from "../runtime-config.js";

interface TestRuntimeConfig {
  apiBaseUrl: string;
  apiVersion: string;
}

function ConfigConsumer() {
  const config = useRuntimeConfig<TestRuntimeConfig>();
  return (
    <div>
      {config.apiBaseUrl}:{config.apiVersion}
    </div>
  );
}

afterEach(() => {
  resetRuntimeConfigForTests();
});

describe("RuntimeConfigProvider", () => {
  it("provides runtime config through context", () => {
    render(
      <RuntimeConfigProvider
        config={{ apiBaseUrl: "https://api.example.com", apiVersion: "v9" }}
      >
        <ConfigConsumer />
      </RuntimeConfigProvider>,
    );

    expect(screen.getByText("https://api.example.com:v9")).toBeTruthy();
  });

  it("stores runtime config for non-React consumers", () => {
    render(
      <RuntimeConfigProvider
        config={{ apiBaseUrl: "https://api.example.com", apiVersion: "v9" }}
      >
        <div>ready</div>
      </RuntimeConfigProvider>,
    );

    expect(getRuntimeConfig<TestRuntimeConfig>()).toEqual({
      apiBaseUrl: "https://api.example.com",
      apiVersion: "v9",
    });
  });

  it("throws when accessed outside a provider", () => {
    expect(() => getRuntimeConfig<TestRuntimeConfig>()).toThrow(
      "Runtime config unavailable",
    );
  });
});
