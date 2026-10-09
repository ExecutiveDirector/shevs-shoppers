const { body } = require("express-validator");

// Safaricom and Airtel numbers start 07… or 01… (e.g. 0112 345 678).
const KENYAN_PHONE = /^(?:\+254|254|0)[17]\d{8}$/;

const createOrderRules = [
  body("customerName").trim().isLength({ min: 2, max: 80 }).withMessage("Enter the full name for delivery."),
  body("phone")
    .trim()
    .matches(KENYAN_PHONE)
    .withMessage("Enter a valid Kenyan phone number, e.g. 07XXXXXXXX."),
  body("customerEmail").optional({ values: "falsy" }).trim().isEmail().withMessage("That email address doesn't look right.").isLength({ max: 120 }),
  body("county").trim().isLength({ min: 2, max: 40 }).withMessage("Select a county."),
  body("address").trim().isLength({ min: 3, max: 200 }).withMessage("Enter the estate or street address."),
  body("paymentMethod").isIn(["mpesa", "cod"]).withMessage("Choose a valid payment method."),
  body("couponCode").optional({ values: "falsy" }).trim().isLength({ max: 40 }),
  body("items").isArray({ min: 1 }).withMessage("Your cart is empty."),
  body("items.*.productId").isInt({ min: 1 }).withMessage("Invalid item in cart."),
  body("items.*.variantId").optional({ values: "falsy" }).isInt({ min: 1 }).withMessage("Invalid size in cart.").toInt(),
  body("items.*.color").optional({ values: "falsy" }).isString().isLength({ max: 40 }).withMessage("Invalid colour in cart."),
  body("items.*.qty").isInt({ min: 1, max: 20 }).withMessage("Quantity must be between 1 and 20."),
];

const reviewRules = [
  body("orderCode").trim().matches(/^SHV-[A-Z0-9]{6}$/i).withMessage("Enter your order number, like SHV-ABC234."),
  body("phone").trim().matches(KENYAN_PHONE).withMessage("Enter the phone number you ordered with."),
  body("name").trim().isLength({ min: 2, max: 60 }).withMessage("Enter your name."),
  body("rating").isInt({ min: 1, max: 5 }).withMessage("Choose 1 to 5 stars.").toInt(),
  body("comment").optional({ values: "falsy" }).trim().isLength({ max: 1000 }).withMessage("Keep your review under 1000 characters."),
];
const notifyRules = [
  body("contact").trim().custom((v) => /^\S+@\S+\.\S+$/.test(v) || KENYAN_PHONE.test(v)).withMessage("Enter a phone number (07XXXXXXXX) or an email address."),
];

const password = (field, msg) => body(field).isString().isLength({ min: 8, max: 100 }).withMessage(msg || "Use a password of at least 8 characters.");
const registerRules = [
  body("name").trim().isLength({ min: 2, max: 80 }).withMessage("Enter your name."),
  body("phone").trim().matches(KENYAN_PHONE).withMessage("Enter a valid Kenyan phone number, e.g. 07XXXXXXXX."),
  body("email").optional({ values: "falsy" }).trim().isEmail().withMessage("That email address doesn't look right.").isLength({ max: 120 }),
  password("password"),
];
const loginRules = [
  body("login").trim().isLength({ min: 3, max: 120 }).withMessage("Enter your phone number or email."),
  body("password").isString().isLength({ min: 1, max: 100 }).withMessage("Enter your password."),
];
const profileRules = [
  body("name").optional().trim().isLength({ min: 2, max: 80 }).withMessage("Enter your name."),
  body("email").optional({ values: "falsy" }).trim().isEmail().withMessage("That email address doesn't look right.").isLength({ max: 120 }),
  body("phone").optional({ values: "falsy" }).trim().matches(KENYAN_PHONE).withMessage("Enter a valid Kenyan phone number, e.g. 07XXXXXXXX."),
  body("county").optional({ values: "falsy" }).trim().isLength({ max: 40 }),
  body("address").optional({ values: "falsy" }).trim().isLength({ max: 200 }),
  body("newPassword").optional({ values: "falsy" }).isString().isLength({ min: 8, max: 100 }).withMessage("Use a new password of at least 8 characters."),
  body("currentPassword").optional().isString().isLength({ max: 100 }),
];
const claimRules = [
  body("orderCode").trim().matches(/^SHV-[A-Z0-9]{6}$/i).withMessage("Enter your order number, like SHV-ABC234."),
  body("phone").trim().matches(KENYAN_PHONE).withMessage("Enter the phone number you ordered with."),
];
const googleRules = [body("credential").isString().isLength({ min: 20, max: 4000 }).withMessage("Google sign-in failed. Please try again.")];
const forgotRules = [body("login").trim().isLength({ min: 3, max: 120 }).withMessage("Enter your phone number or email.")];
const resetRules = [
  body("login").trim().isLength({ min: 3, max: 120 }),
  body("code").trim().matches(/^\d{6}$/).withMessage("Enter the 6-digit code from your email."),
  password("newPassword"),
];

module.exports = { createOrderRules, reviewRules, notifyRules, registerRules, loginRules, profileRules, claimRules, forgotRules, resetRules, googleRules };
