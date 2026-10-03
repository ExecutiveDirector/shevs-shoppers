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

module.exports = { orderLimiter, couponLimiter };
