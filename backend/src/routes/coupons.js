const router = require("express").Router();
const couponController = require("../controllers/couponController");
const { validateCouponRules } = require("../validators/couponValidator");
const validate = require("../middleware/validate");
const { couponLimiter } = require("../middleware/rateLimiters");

router.post("/validate", couponLimiter, validateCouponRules, validate, couponController.validateCoupon);

module.exports = router;
