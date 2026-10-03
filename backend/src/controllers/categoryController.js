const categoryModel = require("../models/categoryModel");
const asyncHandler = require("../utils/asyncHandler");

const list = asyncHandler(async (req, res) => {
  const categories = await categoryModel.findAll();
  res.json({ categories });
});

module.exports = { list };
