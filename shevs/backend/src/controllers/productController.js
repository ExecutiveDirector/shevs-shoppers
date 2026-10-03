const productModel = require("../models/productModel");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");

const list = asyncHandler(async (req, res) => {
  const { category, q, minPrice, maxPrice, minRating, onSale, sort, page, pageSize } = req.query;
  const limit = Math.min(Number(pageSize) || 40, 100);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;

  const products = await productModel.findAll({
    categoryId: category != null ? Number(category) : null,
    search: q || null,
    minPrice: minPrice != null ? Number(minPrice) : null,
    maxPrice: maxPrice != null ? Number(maxPrice) : null,
    minRating: minRating != null ? Number(minRating) : null,
    onSaleOnly: onSale === "true",
    sort,
    limit,
    offset,
  });

  res.json({ products, page: Number(page) || 1, pageSize: limit });
});

const getOne = asyncHandler(async (req, res) => {
  const product = await productModel.findById(Number(req.params.id));
  if (!product) throw ApiError.notFound("Product not found.");

  const related = await productModel.findRelated(product.category_id, product.id);
  res.json({ product, related });
});

module.exports = { list, getOne };
