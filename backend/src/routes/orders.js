const router = require("express").Router();
const orderController = require("../controllers/orderController");
const { createOrderRules } = require("../validators/orderValidator");
const validate = require("../middleware/validate");
const { orderLimiter } = require("../middleware/rateLimiters");

router.post("/", orderLimiter, createOrderRules, validate, orderController.create);
router.get("/:code", orderController.getByCode);

module.exports = router;
