const router = require("express").Router();
const imageModel = require("../models/imageModel");

// Public: product photos, e.g. /api/images/12.webp or /api/images/12.webp?w=400
router.get("/:id.webp", async (req, res, next) => {
  try {
    const data = await imageModel.get(Number(req.params.id), req.query.w && Number(req.query.w) <= 400 ? "thumb" : "large");
    if (!data) return res.status(404).end();
    // helmet defaults to same-origin; the storefront lives on another domain.
    res.set({ "Content-Type": "image/webp", "Cache-Control": "public, max-age=31536000, immutable", "Cross-Origin-Resource-Policy": "cross-origin" });
    res.send(data);
  } catch (e) { next(e); }
});

module.exports = router;
