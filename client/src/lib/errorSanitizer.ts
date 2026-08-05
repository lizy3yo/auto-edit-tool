/**
 * Error sanitizer — intercepts ONLY credit/quota depletion error messages
 * and replaces them with a generic message that doesn't expose internal details.
 *
 * IMPORTANT: This must ONLY trigger for actual credit/quota depletion.
 * Transient API errors (e.g. "Create image error") must NOT be caught here.
 *
 * All users see: "API has no more credits. Please notify Shua on Discord."
 * instead of credit/quota-specific errors.
 */

/**
 * These patterns match ONLY explicit credit/quota depletion messages.
 * They are intentionally narrow to avoid false positives from generic API errors.
 */
const CREDIT_ERROR_PATTERNS = [
  /insufficient.*(credit|balance|fund)/i,
  /not enough.*(credit|balance)/i,
  /credit.*depleted/i,
  /credit.*exhausted/i,
  /quota.*exceeded/i,
  /quota.*exhausted/i,
  /resource.?exhausted/i,
  /out of credits/i,
  /no.*credits.*remaining/i,
  /balance.*insufficient/i,
  /please.*top.?up/i,
  /please.*purchase.*credit/i,
  /credit.*limit.*reached/i,
  /exceeded.*quota/i,
];

const GENERIC_CREDIT_ERROR =
  "API has no more credits. Please notify Shua on Discord.";

/**
 * Check if an error message is specifically about credits/quota depletion.
 * Returns false for generic API errors like "Create image error".
 */
export function isCreditError(message: string): boolean {
  return CREDIT_ERROR_PATTERNS.some(pattern => pattern.test(message));
}

/**
 * Sanitize an error message for display to regular users.
 * ONLY credit/quota depletion errors are replaced with the generic message.
 * All other errors (including transient API failures) are passed through unchanged.
 */
export function sanitizeErrorMessage(message: string): string {
  if (!message) return message;
  if (isCreditError(message)) return GENERIC_CREDIT_ERROR;
  return message;
}

/**
 * Sanitize an error for toast display.
 * Use this in onError callbacks: `onError: (err) => toast.error(sanitizeError(err))`
 */
export function sanitizeError(err: { message: string } | string): string {
  const msg = typeof err === "string" ? err : err.message;
  return sanitizeErrorMessage(msg);
}
