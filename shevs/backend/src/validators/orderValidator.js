const { body } = require("express-validator");

const KENYAN_PHONE = /^(?:\+254|254|0)7\d{8}$/;

const createOrderRules = [
  body("customerName").trim().isLength({ min: 2, max: 80 }).withMessage("Enter the full name for delivery."),
  body("phone")
    .trim()
    .matches(KENYAN_PHONE)
    .withMessage("Enter a valid Kenyan phone number, e.g. 07XXXXXXXX."),
  body("county").trim().isLength({ min: 2, max: 40 }).withMessage("Select a county."),
  body("address").trim().isLength({ min: 3, max: 200 }).withMessage("Enter the estate or street address."),
  body("paymentMethod").isIn(["mpesa", "cod"]).withMessage("Choose a valid payment method."),
  body("couponCode").optional({ values: "falsy" }).trim().isLength({ max: 40 }),
  body("items").isArray({ min: 1 }).withMessage("Your cart is empty."),
  body("items.*.productId").isInt({ min: 1 }).withMessage("Invalid item in cart."),
  body("items.*.qty").isInt({ min: 1, max: 20 }).withMessage("Quantity must be between 1 and 20."),
];

module.exports = { createOrderRules };
