const rateLimit = require("express-rate-limit");

// Order creation touches stock and sends a WhatsApp handoff, so it's the
// endpoint most worth protecting from scripted abuse.
const orderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: "Too many orders from this device. Please try again shortly." } },
});

const couponLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: "Too many attempts. Please wait a moment and try again." } },
});

// Review and "notify me" forms are public, so keep scripted spam out.
const formLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: "Too many attempts. Please try again in a few minutes." } },
});

// Only failed admin-key attempts count, so normal use is never throttled but
// guessing the key is.
const adminAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: "Too many failed attempts. Try again in a few minutes." } },
});

module.exports = { orderLimiter, couponLimiter, adminAuthLimiter, formLimiter };
