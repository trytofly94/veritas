/**
 * D-23: Global error envelope middleware.
 * Standardizes all /api/* error responses to {error: true, code, message} shape.
 * German messages per D-10/D-23 UI contract.
 */

import type { Context } from "hono";
import type { Hono } from "hono";

export type ErrorCode =
  | "UNAUTHORIZED"
  | "FILE_TOO_LARGE"
  | "INVALID_REQUEST"
  | "TSA_UNAVAILABLE"
  | "NOT_FOUND"
  | "INTERNAL_ERROR";

export interface ErrorBody {
  error: true;
  code: ErrorCode;
  message: string;
}

/**
 * Return a standardized JSON error response with the D-23 envelope shape.
 */
export function errorResponse(
  c: Context,
  status: 400 | 401 | 404 | 413 | 500 | 502,
  code: ErrorCode,
  message: string,
): Response {
  return c.json<ErrorBody>({ error: true, code, message }, status);
}

/**
 * Register global notFound and onError handlers on the Hono app.
 * Must be called before route registration so handlers are installed app-wide.
 */
export function registerErrorEnvelope(app: Hono): void {
  app.notFound((c) => errorResponse(c, 404, "NOT_FOUND", "Nicht gefunden."));
  app.onError((err, c) => {
    console.error("[error]", err);
    return errorResponse(c, 500, "INTERNAL_ERROR", "Unbekannter Fehler.");
  });
}
