const crypto = require("crypto");
const ApiError = require("../utils/ApiError");

// Compares in constant time so response timing can't be used to guess the key
// one character at a time. Hashing first makes both buffers equal length.
function safeEqual(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Protects admin-only routes with a single shared secret sent as the
 * `x-admin-key` header.
 *
 * This is intentionally simple: Shevs has one shop owner, not a team of
 * staff accounts, so a long random shared key is enough and avoids the
 * extra surface area (password resets, sessions, roles) a full login
 * system would add. If staff accounts are ever needed, swap this out
 * for proper per-user auth without touching the routes that use it.
 */
function adminAuth(req, res, next) {
  const key = req.get("x-admin-key");
  const expected = process.env.ADMIN_API_KEY;

  if (!expected) {
    // Fail closed: a missing server-side key must never mean "let everyone in".
    return next(new ApiError(500, "Admin access is not configured on the server."));
  }
  if (!key || !safeEqual(key, expected)) {
    return next(ApiError.unauthorized("Invalid or missing admin key."));
  }
  next();
}

module.exports = adminAuth;
