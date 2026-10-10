const router = require("express").Router();
// Catalogue data changes rarely; let browsers and the CDN reuse it briefly.
const shortCache = (req, res, next) => {
  res.set("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
  next();
};

const { formLimiter } = require("../middleware/rateLimiters");
const validate = require("../middleware/validate");
const { lookupReviewRules, reviewRules, notifyRules } = require("../validators/orderValidator");
const engagement = require("../controllers/engagementController");
const productController = require("../controllers/productController");

router.post("/review-lookup", formLimiter, lookupReviewRules, validate, engagement.lookupReview);
router.get("/", shortCache, productController.list);
router.get("/:id/reviews", shortCache, engagement.listReviews);
router.post("/:id/reviews", formLimiter, reviewRules, validate, engagement.submitReview);
router.post("/:id/notify", formLimiter, notifyRules, validate, engagement.notify);
router.get("/:id", shortCache, productController.getOne);

module.exports = router;
