import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { PlatformClient, parseEffectiveAccess } from "../src/index.js";

describe("effective access", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("requests the opt-in current-user expansion with repeated entitlement parameters", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: "usr_test" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new PlatformClient({ baseUrl: "https://platform.test" });
    await client.users.me({
      entitlement: ["archdev_access", "another_entitlement"],
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://platform.test/api/v1/users/me?entitlement%5B%5D=archdev_access&entitlement%5B%5D=another_entitlement",
    );
  });

  it("validates known boolean entries and preserves additive projection fields", () => {
    const parsed = parseEffectiveAccess({
      entitlements: [{
        key: "archdev_access",
        granted: true,
        value_type: "boolean",
        value: true,
        provided_by: ["organization"],
        evaluation_version: 2,
      }],
      billing: [
        { principal_type: "user", administrator: true },
        { principal_type: "org", administrator: false },
      ],
      quota_summaries: [{ key: "reviews", remaining: 4 }],
    });

    expect(parsed.quota_summaries).toEqual([{ key: "reviews", remaining: 4 }]);
    expect(parsed.entitlements[0]).toMatchObject({
      key: "archdev_access",
      supported: true,
      value: true,
      evaluation_version: 2,
    });
  });

  it("retains an unknown value tag without interpreting its value", () => {
    const parsed = parseEffectiveAccess({
      entitlements: [{
        key: "future_access_level",
        granted: true,
        value_type: "level",
        value: "advanced",
        provided_by: ["personal"],
        merge_policy: "highest",
      }],
      billing: [{ principal_type: "user", administrator: true }],
    });

    expect(parsed.entitlements[0]).toEqual({
      key: "future_access_level",
      granted: true,
      value_type: "level",
      value: "advanced",
      provided_by: ["personal"],
      merge_policy: "highest",
      supported: false,
    });
  });

  it("rejects an invalid value for a known tag", () => {
    expect(() => parseEffectiveAccess({
      entitlements: [{
        key: "archdev_access",
        granted: true,
        value_type: "boolean",
        value: "yes",
        provided_by: ["personal"],
      }],
      billing: [{ principal_type: "user", administrator: true }],
    })).toThrow(z.ZodError);
  });

  it("validates stable billing principal members", () => {
    expect(() => parseEffectiveAccess({
      entitlements: [],
      billing: [{ principal_type: "workspace", administrator: true }],
    })).toThrow(z.ZodError);
  });
});
