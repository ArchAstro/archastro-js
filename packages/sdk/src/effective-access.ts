import { z } from "zod";

import type { EffectiveAccessBillingPrincipal } from "./types/common.js";

export type EffectiveAccessSource = "personal" | "organization";

interface ParsedEffectiveAccessEntitlementBase {
  key: string;
  granted: boolean;
  value_type: string;
  provided_by: EffectiveAccessSource[];
  value?: unknown;
  [key: string]: unknown;
}

/** An entitlement whose tagged value is understood by this SDK release. */
export interface SupportedBooleanEffectiveAccessEntitlement
  extends ParsedEffectiveAccessEntitlementBase {
  supported: true;
  value_type: "boolean";
  value?: boolean | null;
}

/** A future entitlement tag retained without interpreting its value. */
export interface UnsupportedEffectiveAccessEntitlement
  extends ParsedEffectiveAccessEntitlementBase {
  supported: false;
}

export type ParsedEffectiveAccessEntitlement =
  | SupportedBooleanEffectiveAccessEntitlement
  | UnsupportedEffectiveAccessEntitlement;

/** A validated effective-access projection that preserves additive fields. */
export interface ParsedEffectiveAccess {
  entitlements: ParsedEffectiveAccessEntitlement[];
  billing: EffectiveAccessBillingPrincipal[];
  [key: string]: unknown;
}

const entitlementWireSchema = z.object({
  key: z.string(),
  granted: z.boolean(),
  value_type: z.string(),
  value: z.unknown().optional(),
  provided_by: z.array(z.enum(["personal", "organization"])),
}).passthrough();

const billingPrincipalSchema = z.object({
  principal_type: z.enum(["user", "org"]),
  administrator: z.boolean(),
}).passthrough();

const effectiveAccessWireSchema = z.object({
  entitlements: z.array(entitlementWireSchema),
  billing: z.array(billingPrincipalSchema),
}).passthrough();

const booleanValueSchema = z.boolean().nullable().optional();

/**
 * Validate the stable effective-access members while retaining future tagged
 * entitlements and additive projection fields.
 */
export function parseEffectiveAccess(input: unknown): ParsedEffectiveAccess {
  const parsed = effectiveAccessWireSchema.parse(input);
  const entitlements = parsed.entitlements.map((entitlement, index) => {
    if (entitlement.value_type !== "boolean") {
      return {
        ...entitlement,
        supported: false,
      } satisfies UnsupportedEffectiveAccessEntitlement;
    }

    const value = booleanValueSchema.safeParse(entitlement.value);
    if (!value.success) {
      throw new z.ZodError(
        value.error.issues.map((issue) => ({
          ...issue,
          path: ["entitlements", index, "value", ...issue.path],
        })),
      );
    }

    return {
      ...entitlement,
      supported: true,
      value_type: "boolean",
      value: value.data,
    } satisfies SupportedBooleanEffectiveAccessEntitlement;
  });

  return {
    ...parsed,
    entitlements,
    billing: parsed.billing,
  };
}
