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
  body("sku").optional({ values: "falsy" }).trim().matches(/^[A-Za-z0-9._\- ]{1,40}$/).withMessage("SKU can use letters, numbers, spaces, . _ - (max 40)."),
  body("brand").optional({ values: "falsy" }).trim().isLength({ max: 80 }).withMessage("Brand is too long (max 80)."),
  body("description").optional({ values: "falsy" }).trim().isLength({ max: 2000 }).withMessage("Description is too long (max 2000 characters)."),
  body("imageUrl").optional({ values: "falsy" }).trim().isURL({ protocols: ["http", "https"], require_protocol: true }).withMessage("Image link must start with http:// or https://.").isLength({ max: 500 }).withMessage("Image link is too long."),
  body("costPrice").optional({ values: "null" }).isFloat({ min: 0, max: 10000000 }).withMessage("Enter a valid cost price.").toFloat(),
  body("lowStockThreshold").optional({ values: "null" }).isInt({ min: 0, max: 100000 }).withMessage("Low-stock alert must be 0 or more.").toInt(),
  body("featured").optional().isBoolean().withMessage("Invalid featured value.").toBoolean(),
  body("tags").optional({ values: "falsy" }).trim().isLength({ max: 255 }).withMessage("Tags are too long (max 255)."),
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

const stockRules = [
  body("mode").isIn(["add", "set"]).withMessage("Choose add or set."),
  body("qty").isInt({ min: -1000000, max: 1000000 }).withMessage("Enter a whole number.").toInt(),
  body("reason").optional().isIn(["restock", "correction", "damaged", "return", "other"]).withMessage("Invalid reason."),
  body("note").optional({ values: "falsy" }).trim().isLength({ max: 200 }).withMessage("Note is too long (max 200)."),
];

const bulkRules = [
  body("ids").isArray({ min: 1, max: 200 }).withMessage("Select at least one product."),
  body("ids.*").isInt({ min: 1 }).withMessage("Invalid product id.").toInt(),
  body("action").isIn(["show", "hide", "feature", "unfeature", "category", "delete"]).withMessage("Unknown bulk action."),
  body("categoryId").if(body("action").equals("category")).isInt({ min: 1 }).withMessage("Choose a category.").toInt(),
];

const noteRules = [body("note").optional({ values: "falsy" }).trim().isLength({ max: 500 }).withMessage("Note is too long (max 500).")];

const settingsRules = [
  body("owner_email").optional({ values: "falsy" }).trim().isEmail().withMessage("Enter a valid email address for order alerts.").isLength({ max: 120 }),
  body("shop_name").optional().trim().isLength({ min: 1, max: 60 }).withMessage("Shop name must be 1–60 characters."),
  body("whatsapp_number").optional().trim().matches(/^\d{10,15}$/).withMessage("WhatsApp number: digits only with country code, e.g. 254712345678."),
  body("delivery_fee").optional().isFloat({ min: 0, max: 100000 }).withMessage("Delivery fee must be 0 or more.").toFloat(),
  body("free_delivery_threshold").optional().isFloat({ min: 0, max: 10000000 }).withMessage("Free-delivery amount must be 0 or more.").toFloat(),
  body("low_stock_threshold").optional().isInt({ min: 0, max: 100000 }).withMessage("Low-stock alert must be 0 or more.").toInt(),
];

const dateField = (n) => body(n).optional({ values: "falsy" }).isISO8601().withMessage("Use a valid date and time.");
const bannerRules = [
  body("title").trim().isLength({ min: 2, max: 80 }).withMessage("Give the banner a title (2–80 characters)."),
  body("subtitle").optional({ values: "falsy" }).trim().isLength({ max: 160 }).withMessage("Subtitle is too long (max 160)."),
  body("imageUrl").optional({ values: "falsy" }).trim().isURL({ protocols: ["http", "https"], require_protocol: true }).withMessage("Image link must start with http:// or https://.").isLength({ max: 500 }),
  body("linkType").optional().isIn(["none", "category", "product"]).withMessage("Invalid link type."),
  body("linkId").optional({ values: "falsy" }).isInt({ min: 1 }).toInt(),
  dateField("startsAt"), dateField("endsAt"),
  body("active").optional().isBoolean().toBoolean(),
  body("sortOrder").optional().isInt({ min: -1000, max: 1000 }).toInt(),
];
const promoRules = [
  body("name").trim().isLength({ min: 2, max: 80 }).withMessage("Give the promotion a name."),
  body("percentOff").isInt({ min: 1, max: 90 }).withMessage("Discount must be between 1% and 90%.").toInt(),
  body("scope").isIn(["all", "category", "product"]).withMessage("Choose what the promotion applies to."),
  body("scopeId").optional({ values: "falsy" }).isInt({ min: 1 }).toInt(),
  body("minQty").optional().isInt({ min: 1, max: 100 }).withMessage("Minimum quantity must be 1–100.").toInt(),
  dateField("startsAt"), dateField("endsAt"),
  body("active").optional().isBoolean().toBoolean(),
  body().custom((v) => { if (v.startsAt && v.endsAt && new Date(v.endsAt) <= new Date(v.startsAt)) throw new Error("The end must be after the start."); return true; }),
];

module.exports = { bannerRules, promoRules, productRules, categoryRules, couponRules, stockRules, bulkRules, noteRules, settingsRules };
