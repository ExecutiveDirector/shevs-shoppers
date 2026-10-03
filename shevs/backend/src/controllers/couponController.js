const couponModel = require("../models/couponModel");
const asyncHandler = require("../utils/asyncHandler");

const validateCoupon = asyncHandler(async (req, res) => {
  const { code, subtotal } = req.body;
  const coupon = await couponModel.findActiveByCode(code);

  if (!coupon) {
    return res.json({ valid: false, message: "That code isn't valid." });
  }
  if (Number(subtotal) < Number(coupon.min_subtotal)) {
    return res.json({
      valid: false,
      message: `Add KES ${(Number(coupon.min_subtotal) - Number(subtotal)).toLocaleString("en-KE")} more to use this code.`,
    });
  }

  res.json({
    valid: true,
    code: coupon.code,
    discountAmount: Number(coupon.discount_amount),
    message: `Applied — KES ${Number(coupon.discount_amount).toLocaleString("en-KE")} off`,
  });
});

module.exports = { validateCoupon };
