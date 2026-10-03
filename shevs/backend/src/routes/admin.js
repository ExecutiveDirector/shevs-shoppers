const router = require("express").Router();
const orderController = require("../controllers/orderController");
const adminAuth = require("../middleware/adminAuth");
const { updateOrderStatusRules } = require("../validators/couponValidator");
const validate = require("../middleware/validate");

router.use(adminAuth);

router.get("/orders", orderController.listAll);
router.patch("/orders/:code/status", updateOrderStatusRules, validate, orderController.updateStatus);

module.exports = router;
