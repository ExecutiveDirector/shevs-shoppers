const router = require("express").Router();
const c = require("../controllers/adminController");
const adminAuth = require("../middleware/adminAuth");
const validate = require("../middleware/validate");
const { updateOrderStatusRules } = require("../validators/couponValidator");
const { productRules, categoryRules, couponRules } = require("../validators/adminValidator");

router.use(adminAuth);

router.get("/stats", c.stats);

router.get("/orders", c.listOrders);
router.get("/orders/:code", c.getOrder);
router.patch("/orders/:code/status", updateOrderStatusRules, validate, c.setOrderStatus);

router.get("/products", c.listProducts);
router.post("/products", productRules(false), validate, c.createProduct);
router.patch("/products/:id", productRules(true), validate, c.updateProduct);
router.delete("/products/:id", c.deleteProduct);

router.get("/categories", c.listCategories);
router.post("/categories", categoryRules(false), validate, c.createCategory);
router.patch("/categories/:id", categoryRules(true), validate, c.updateCategory);
router.delete("/categories/:id", c.deleteCategory);

router.get("/coupons", c.listCoupons);
router.post("/coupons", couponRules(false), validate, c.createCoupon);
router.patch("/coupons/:id", couponRules(true), validate, c.updateCoupon);
router.delete("/coupons/:id", c.deleteCoupon);

router.get("/customers", c.listCustomers);

module.exports = router;
