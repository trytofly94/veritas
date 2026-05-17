import { ulid } from "ulid";

/** Generate a fresh ULID for a bundle directory name (Crockford base32, 26 chars). */
export function newId(): string {
  return ulid();
}
