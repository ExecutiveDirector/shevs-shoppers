const router = require("express").Router();
const c = require("../controllers/adminController");
const adminAuth = require("../middleware/adminAuth");
const validate = require("../middleware/validate");
const { adminAuthLimiter } = require("../middleware/rateLimiters");
const { updateOrderStatusRules } = require("../validators/couponValidator");
const e = require("../controllers/engagementController");
const dc = require("../controllers/deliveryController");
const { zoneRules, areaRules, areasAddRules, orderFeeRules, variantsRules, photosRules, bannerRules, promoRules, productRules, categoryRules, couponRules, stockRules, bulkRules, noteRules, settingsRules } = require("../validators/adminValidator");

router.use(adminAuthLimiter, adminAuth);

router.get("/stats", c.stats);

// Raw image bytes (not JSON) so the admin can upload a photo straight from the file picker.
router.post("/uploads", require("express").raw({ type: ["image/*"], limit: "8mb" }), c.uploadImage);

router.get("/ai-status", c.aiStatus);
router.post("/photos/identify", require("express").raw({ type: ["image/*"], limit: "4mb" }), c.identifyPhoto);

router.get("/delivery", dc.adminList);
router.post("/delivery/zones", zoneRules, validate, dc.zoneCreate);
router.patch("/delivery/zones/:id", zoneRules, validate, dc.zoneUpdate);
router.delete("/delivery/zones/:id", dc.zoneDelete);
router.post("/delivery/zones/:id/areas", areasAddRules, validate, dc.areasAdd);
router.patch("/delivery/areas/:id", areaRules, validate, dc.areaUpdate);
router.delete("/delivery/areas/:id", dc.areaDelete);

router.get("/orders", c.listOrders);
router.get("/orders/:code", c.getOrder);
router.patch("/orders/:code/status", updateOrderStatusRules, validate, c.setOrderStatus);
router.patch("/orders/:code/delivery", orderFeeRules, validate, dc.orderFee);
router.patch("/orders/:code/note", noteRules, validate, c.setOrderNote);

router.get("/products", c.listProducts);
router.post("/products", productRules(false), validate, c.createProduct);
router.post("/products/bulk", bulkRules, validate, c.bulkProducts);
router.get("/products/:id", c.getProduct);
router.post("/products/:id/stock", stockRules, validate, c.adjustStock);
router.post("/products/:id/duplicate", c.duplicateProduct);
router.patch("/products/:id", productRules(true), validate, c.updateProduct);
router.put("/products/:id/variants", variantsRules, validate, c.putVariants);
router.put("/products/:id/photos", photosRules, validate, c.putPhotos);
router.delete("/products/:id", c.deleteProduct);

router.get("/categories", c.listCategories);
router.post("/categories", categoryRules(false), validate, c.createCategory);
router.patch("/categories/:id", categoryRules(true), validate, c.updateCategory);
router.delete("/categories/:id", c.deleteCategory);

router.get("/coupons", c.listCoupons);
router.post("/coupons", couponRules(false), validate, c.createCoupon);
router.patch("/coupons/:id", couponRules(true), validate, c.updateCoupon);
router.delete("/coupons/:id", c.deleteCoupon);

router.get("/reports/sales", c.salesReport);
router.get("/reports/export", c.exportCsv);
router.get("/badges", e.badges);
router.get("/alerts", e.adminAlerts);
router.post("/alerts/:id/done", e.alertDone);
router.delete("/alerts/:id", e.alertDelete);
router.get("/reviews", e.adminReviews);
router.patch("/reviews/:id", e.reviewStatus);
router.delete("/reviews/:id", e.reviewDelete);
router.get("/banners", e.adminBanners);
router.post("/banners", bannerRules, validate, e.bannerCreate);
router.patch("/banners/:id", bannerRules, validate, e.bannerUpdate);
router.delete("/banners/:id", e.bannerDelete);
router.get("/promotions", e.adminPromos);
router.post("/promotions", promoRules, validate, e.promoCreate);
router.patch("/promotions/:id", promoRules, validate, e.promoUpdate);
router.delete("/promotions/:id", e.promoDelete);

router.post("/accounts/:id/reset-password", require("../controllers/accountController").adminResetPassword);
router.get("/customers", c.listCustomers);

router.get("/settings", c.getSettings);
router.post("/settings/test-email", c.testEmail);
router.patch("/settings", settingsRules, validate, c.updateSettings);

module.exports = router;
