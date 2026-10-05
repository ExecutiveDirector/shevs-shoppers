const router = require("express").Router();
// Catalogue data changes rarely; let browsers and the CDN reuse it briefly.
const shortCache = (req, res, next) => {
  res.set("Cache-Control", "public, max-age=30, stale-while-revalidate=60");
  next();
};

const productController = require("../controllers/productController");

router.get("/", shortCache, productController.list);
router.get("/:id", shortCache, productController.getOne);

module.exports = router;
