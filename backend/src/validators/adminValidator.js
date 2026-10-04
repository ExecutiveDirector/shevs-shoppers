const { body } = require("express-validator");

const optionalIf = (isUpdate, chain) => (isUpdate ? chain.optional() : chain);

const productRules = (isUpdate) => [
  optionalIf(isUpdate, body("name")).trim().isLength({ min: 2, max: 160 }).withMessage("Enter a product name (2–160 characters)."),
  optionalIf(isUpdate, body("categoryId")).isInt({ min: 1 }).withMessage("Choose a category.").toInt(),
  body("emoji").optional({ values: "falsy" }).trim().isLength({ max: 8 }).withMessage("Emoji is too long."),
  optionalIf(isUpdate, body("price")).isFloat({ min: 1, max: 10000000 }).withMessage("Enter a price above 0.").toFloat(),
  body("compareAtPrice").optional({ values: "null" }).isFloat({ min: 1, max: 10000000 }).withMessage("Enter a valid 'was' price.").toFloat(),
  body("stock").optional().isInt({ min: 0, max: 1000000 }).withMessage("Stock must be 0 or more.").toInt(),
  body("etaLabel").optional({ values: "falsy" }).trim().isLength({ max: 40 }).withMessage("Delivery estimate is too long."),
  body("active").optional().isBoolean().withMessage("Invalid visibility value.").toBoolean(),
  body().custom((v) => {
    if (v.price != null && v.compareAtPrice != null && Number(v.compareAtPrice) < Number(v.price)) {
      throw new Error("The 'was' price can't be lower than the selling price.");
    }
    return true;
  }),
];

const categoryRules = (isUpdate) => [
  optionalIf(isUpdate, body("name")).trim().isLength({ min: 2, max: 80 }).withMessage("Enter a category name."),
  optionalIf(isUpdate, body("icon")).trim().isLength({ min: 1, max: 8 }).withMessage("Pick an emoji icon."),
  body("sortOrder").optional({ values: "null" }).isInt({ min: 0, max: 10000 }).withMessage("Invalid sort order.").toInt(),
];

const couponRules = (isUpdate) => [
  optionalIf(isUpdate, body("code"))
    .trim()
    .matches(/^[A-Za-z0-9_-]{2,40}$/)
    .withMessage("Code must be 2–40 letters, numbers, - or _."),
  optionalIf(isUpdate, body("discountAmount")).isFloat({ min: 1, max: 10000000 }).withMessage("Enter a discount above 0.").toFloat(),
  body("minSubtotal").optional().isFloat({ min: 0, max: 10000000 }).withMessage("Invalid minimum spend.").toFloat(),
  body("active").optional().isBoolean().withMessage("Invalid value.").toBoolean(),
  body("expiresAt").optional({ values: "falsy" }).isISO8601().withMessage("Enter a valid expiry date."),
];

module.exports = { productRules, categoryRules, couponRules };
