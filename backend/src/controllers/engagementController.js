const model = require("../models/engagementModel");
const settingsModel = require("../models/settingsModel");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");

const id = (req) => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n < 1) throw ApiError.badRequest("Invalid id.");
  return n;
};

/* ---- public ---- */
const listReviews = asyncHandler(async (req, res) => res.json({ reviews: await model.listApproved(id(req)) }));

const submitReview = asyncHandler(async (req, res) => {
  await model.submitReview(id(req), req.body);
  res.status(201).json({ ok: true, message: "Thanks! Your review will appear once the shop approves it." });
});

const notify = asyncHandler(async (req, res) => {
  await model.addAlert(id(req), req.body.contact);
  res.status(201).json({ ok: true, message: "Done — we'll let you know when it's back." });
});

/* ---- admin ---- */
const adminAlerts = asyncHandler(async (req, res) => {
  const [alerts, s] = await Promise.all([model.listAlerts(), settingsModel.getAll()]);
  res.json({ alerts, shopName: s.shop_name });
});
const alertDone = asyncHandler(async (req, res) => {
  if (!(await model.markAlert(id(req)))) throw ApiError.notFound("Signup not found.");
  res.json({ ok: true });
});
const alertDelete = asyncHandler(async (req, res) => {
  if (!(await model.deleteAlert(id(req)))) throw ApiError.notFound("Signup not found.");
  res.json({ ok: true });
});

const adminReviews = asyncHandler(async (req, res) => {
  const status = ["pending", "approved", "rejected"].includes(req.query.status) ? req.query.status : null;
  res.json({ reviews: await model.listReviews({ status }) });
});
const reviewStatus = asyncHandler(async (req, res) => {
  const st = req.body.status;
  if (!["pending", "approved", "rejected"].includes(st)) throw ApiError.badRequest("Invalid status.");
  if (!(await model.setReviewStatus(id(req), st))) throw ApiError.notFound("Review not found.");
  res.json({ ok: true });
});
const reviewDelete = asyncHandler(async (req, res) => {
  if (!(await model.deleteReview(id(req)))) throw ApiError.notFound("Review not found.");
  res.json({ ok: true });
});

const adminBanners = asyncHandler(async (req, res) => res.json({ banners: await model.listBanners() }));
const bannerSave = (isUpdate) => asyncHandler(async (req, res) => {
  const out = await model.saveBanner(isUpdate ? id(req) : null, req.body);
  if (!out) throw ApiError.notFound("Banner not found.");
  res.status(isUpdate ? 200 : 201).json({ ok: true, id: isUpdate ? id(req) : out });
});
const bannerDelete = asyncHandler(async (req, res) => {
  if (!(await model.deleteBanner(id(req)))) throw ApiError.notFound("Banner not found.");
  res.json({ ok: true });
});

const adminPromos = asyncHandler(async (req, res) => res.json({ promotions: await model.listPromotions() }));
const promoSave = (isUpdate) => asyncHandler(async (req, res) => {
  const out = await model.savePromotion(isUpdate ? id(req) : null, req.body);
  if (!out) throw ApiError.notFound("Promotion not found.");
  res.status(isUpdate ? 200 : 201).json({ ok: true });
});
const promoDelete = asyncHandler(async (req, res) => {
  if (!(await model.deletePromotion(id(req)))) throw ApiError.notFound("Promotion not found.");
  res.json({ ok: true });
});

const badges = asyncHandler(async (req, res) => {
  const [alerts, reviews] = await Promise.all([model.pendingCount(), model.pendingReviews()]);
  res.json({ alerts, reviews });
});

module.exports = {
  listReviews, submitReview, notify,
  adminAlerts, alertDone, alertDelete, adminReviews, reviewStatus, reviewDelete,
  adminBanners, bannerCreate: bannerSave(false), bannerUpdate: bannerSave(true), bannerDelete,
  adminPromos, promoCreate: promoSave(false), promoUpdate: promoSave(true), promoDelete, badges,
};
