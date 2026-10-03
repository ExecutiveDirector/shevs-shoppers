const router = require("express").Router();
const productController = require("../controllers/productController");

router.get("/", productController.list);
router.get("/:id", productController.getOne);

module.exports = router;
