// Copyright (c) 2025 ArchAstro Inc. All Rights Reserved.

/**
 * Request helpers for Next.js API routes and middleware.
 *
 * When running behind a load balancer or reverse proxy, request.url contains
 * the internal container URL (e.g., localhost:8080). These helpers use
 * x-forwarded-host and x-forwarded-proto headers to construct correct external URLs.
 *
 * Use these functions when you have access to the request object (API routes, middleware).
 * For server actions/components, use getExternalBaseUrl from federated-auth which uses
 * the headers() function directly.
 */

import type { NextRequest } from "next/server";

/**
 * Minimal request interface for request helpers.
 * Compatible with NextRequest, Request, and similar.
 */
export interface RequestWithHeaders {
  headers: {
    get(name: string): string | null;
  };
  url: string;
}

/**
 * Extended request interface that includes nextUrl (NextRequest).
 */
export interface NextRequestLike extends RequestWithHeaders {
  nextUrl: {
    origin: string;
    pathname: string;
    searchParams: URLSearchParams;
  };
}

/**
 * Get the external base URL for redirects from a request object.
 *
 * When the app runs behind a load balancer (e.g., GCP), request.url returns the
 * internal container URL (localhost:8080). This function uses x-forwarded-host
 * and x-forwarded-proto headers to construct the correct external URL.
 *
 * @param request - The incoming request object (NextRequest or Request)
 * @param fallbackUrl - Optional fallback URL if forwarded headers are not present
 * @returns The external base URL
 *
 * @example
 * ```ts
 * // In a Next.js API route
 * import { getExternalBaseUrlFromRequest } from "@archastro/sdk-nextjs/server";
 *
 * export async function GET(request: NextRequest) {
 *   const baseUrl = getExternalBaseUrlFromRequest(request);
 *   return NextResponse.redirect(new URL("/dashboard", baseUrl));
 * }
 * ```
 */
export function getExternalBaseUrlFromRequest(
  request: RequestWithHeaders | NextRequestLike | NextRequest,
  fallbackUrl?: URL | string
): URL {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const forwardedProto = request.headers.get("x-forwarded-proto") || "https";

  if (forwardedHost) {
    return new URL(`${forwardedProto}://${forwardedHost}`);
  }

  // Fallback for development or when not behind a proxy
  if (fallbackUrl) {
    return typeof fallbackUrl === "string" ? new URL(fallbackUrl) : fallbackUrl;
  }

  // Use nextUrl.origin if available (NextRequest), otherwise parse request.url
  if ("nextUrl" in request && request.nextUrl) {
    return new URL(request.nextUrl.origin);
  }

  return new URL(new URL(request.url).origin);
}

/**
 * Get the pathname from a request.
 *
 * Use this instead of `new URL(request.url).pathname` to safely extract
 * the pathname without issues from internal URLs behind proxies.
 *
 * @param request - The incoming request object
 * @returns The pathname from the request URL
 */
export function getPathname(
  request: RequestWithHeaders | NextRequestLike | NextRequest
): string {
  if ("nextUrl" in request && request.nextUrl) {
    return request.nextUrl.pathname;
  }
  return new URL(request.url).pathname;
}

/**
 * Get the search params from a request.
 *
 * Use this instead of `new URL(request.url).searchParams` to safely extract
 * search params without issues from internal URLs behind proxies.
 *
 * @param request - The incoming request object
 * @returns The URLSearchParams from the request URL
 */
export function getSearchParams(
  request: RequestWithHeaders | NextRequestLike | NextRequest
): URLSearchParams {
  if ("nextUrl" in request && request.nextUrl) {
    return request.nextUrl.searchParams;
  }
  return new URL(request.url).searchParams;
}
