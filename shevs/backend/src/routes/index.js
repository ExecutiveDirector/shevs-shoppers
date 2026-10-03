const router = require("express").Router();

router.use("/products", require("./products"));
router.use("/categories", require("./categories"));
router.use("/coupons", require("./coupons"));
router.use("/orders", require("./orders"));
router.use("/admin", require("./admin"));

router.get("/health", (req, res) => res.json({ ok: true }));

module.exports = router;
