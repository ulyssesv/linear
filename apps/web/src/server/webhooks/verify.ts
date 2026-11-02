// Authenticity of a Linear webhook delivery (MIRROR-R11), per
// https://linear.app/developers/webhooks#securing-webhooks:
//
// - `Linear-Signature` is the hex HMAC-SHA256 of the raw request body, keyed with the
//   webhook's signing secret (LINEAR_WEBHOOK_SECRET). It is computed over the bytes as
//   received, never over re-serialised JSON, and compared in constant time.
// - `webhookTimestamp` in the body is when Linear sent the delivery, in epoch
//   milliseconds. The body is signed, so the timestamp cannot be altered; a delivery more
//   than a minute away from our clock is refused, which bounds how long a captured
//   delivery can be replayed. The `Linear-Timestamp` header carries the same value but is
//   not signed, so it is not trusted.
import { createHmac, timingSafeEqual } from "node:crypto";

/** How far `webhookTimestamp` may be from the receiver's clock, either way. */
export const replayWindowMs = 60_000;

/** The hex HMAC-SHA256 Linear sends in `Linear-Signature` for this body and secret. */
export function sign(body: Uint8Array | string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

/** Whether `signature` is the signature of `body` under `secret`, in constant time. */
export function signatureMatches(
  body: Uint8Array,
  signature: string | null | undefined,
  secret: string,
): boolean {
  if (!signature || secret === "") return false;
  const expected = Buffer.from(sign(body, secret), "utf8");
  const given = Buffer.from(signature.trim().toLowerCase(), "utf8");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Whether a signed `webhookTimestamp` is a number within the replay window of `now`. */
export function timestampFresh(webhookTimestamp: unknown, now: number): boolean {
  return (
    typeof webhookTimestamp === "number" &&
    Number.isFinite(webhookTimestamp) &&
    Math.abs(now - webhookTimestamp) <= replayWindowMs
  );
}
