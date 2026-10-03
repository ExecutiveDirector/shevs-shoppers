const { body } = require("express-validator");

const validateCouponRules = [
  body("code").trim().isLength({ min: 2, max: 40 }).withMessage("Enter a coupon code."),
  body("subtotal").isFloat({ min: 0 }).withMessage("Invalid subtotal."),
];

const updateOrderStatusRules = [
  body("status")
    .isIn(["pending", "confirmed", "dispatched", "delivered", "cancelled"])
    .withMessage("Invalid status."),
];

module.exports = { validateCouponRules, updateOrderStatusRules };
