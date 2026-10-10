const deliveryModel = require("../models/deliveryModel");
const adminModel = require("../models/adminModel");
const settingsModel = require("../models/settingsModel");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");

const id = (req) => {
  const n = Number(req.params.id);
  if (!Number.isInteger(n) || n < 1) throw ApiError.badRequest("Invalid id.");
  return n;
};

const publicList = asyncHandler(async (req, res) => {
  const s = await settingsModel.getAll();
  res.set("Cache-Control", "public, max-age=30");
  res.json({ zones: await deliveryModel.listPublic(s.free_delivery_threshold) });
});

const adminList = asyncHandler(async (req, res) => res.json({ zones: await deliveryModel.listAdmin() }));
const zoneCreate = asyncHandler(async (req, res) => res.status(201).json({ ok: true, id: await deliveryModel.saveZone(null, req.body) }));
const zoneUpdate = asyncHandler(async (req, res) => {
  if (!(await deliveryModel.saveZone(id(req), req.body))) throw ApiError.notFound("Zone not found.");
  res.json({ ok: true });
});
const zoneDelete = asyncHandler(async (req, res) => {
  if (!(await deliveryModel.deleteZone(id(req)))) throw ApiError.notFound("Zone not found.");
  res.json({ ok: true });
});
const areasAdd = asyncHandler(async (req, res) => {
  const n = await deliveryModel.addAreas(id(req), req.body.names, req.body.county);
  if (n === null) throw ApiError.notFound("Zone not found.");
  res.status(201).json({ ok: true, added: n });
});
const areaUpdate = asyncHandler(async (req, res) => {
  try {
    if (!(await deliveryModel.saveArea(id(req), req.body))) throw ApiError.notFound("Place not found.");
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") throw ApiError.conflict("That place already exists in this county.");
    if (e.code === "ER_NO_REFERENCED_ROW_2") throw ApiError.badRequest("That zone doesn't exist.");
    throw e;
  }
  res.json({ ok: true });
});
const areaDelete = asyncHandler(async (req, res) => {
  if (!(await deliveryModel.deleteArea(id(req)))) throw ApiError.notFound("Place not found.");
  res.json({ ok: true });
});
const orderFee = asyncHandler(async (req, res) => {
  const out = await adminModel.setOrderDelivery(req.params.code, Math.round(Number(req.body.fee)));
  if (!out) throw ApiError.notFound("Order not found.");
  res.json({ ok: true, ...out });
});

module.exports = { publicList, adminList, zoneCreate, zoneUpdate, zoneDelete, areasAdd, areaUpdate, areaDelete, orderFee };
