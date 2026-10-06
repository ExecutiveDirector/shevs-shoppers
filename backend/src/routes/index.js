const router = require("express").Router();
const { pool } = require("../config/db");

router.use("/products", require("./products"));
router.use("/categories", require("./categories"));
router.use("/coupons", require("./coupons"));
router.use("/orders", require("./orders"));
router.get("/settings", async (req, res, next) => {
  try {
    const s = await require("../models/settingsModel").getAll();
    res.set("Cache-Control", "public, max-age=30");
    res.json({ shopName: s.shop_name, whatsappNumber: s.whatsapp_number, deliveryFee: s.delivery_fee, freeDeliveryThreshold: s.free_delivery_threshold });
  } catch (e) { next(e); }
});
router.use("/images", require("./images"));
router.use("/admin", require("./admin"));

// Liveness by default; add ?deep=1 to also confirm the database answers.
router.get("/health", async (req, res) => {
  if (!req.query.deep) return res.json({ ok: true });
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, db: "up" });
  } catch (err) {
    console.error("Health check: database unreachable:", err.message);
    res.status(503).json({ ok: false, db: "down" });
  }
});

module.exports = router;
