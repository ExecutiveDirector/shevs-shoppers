const orderModel = require("../models/orderModel");
const { buildOrderWhatsAppLink } = require("../utils/whatsapp");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");

const create = asyncHandler(async (req, res) => {
  const { customerName, phone, county, address, paymentMethod, couponCode, items } = req.body;

  const { order, items: lineItems } = await orderModel.createOrder({
    customerName,
    phone,
    county,
    address,
    paymentMethod,
    couponCode: couponCode || null,
    items,
  });

  const whatsappUrl = buildOrderWhatsAppLink(order, lineItems);

  res.status(201).json({
    orderCode: order.order_code,
    status: order.status,
    subtotal: order.subtotal,
    deliveryFee: order.delivery_fee,
    discount: order.discount,
    total: order.total,
    items: lineItems,
    whatsappUrl,
  });
});

const getByCode = asyncHandler(async (req, res) => {
  const result = await orderModel.findByCode(req.params.code);
  if (!result) throw ApiError.notFound("Order not found.");

  const { order, items } = result;
  res.json({
    orderCode: order.order_code,
    status: order.status,
    subtotal: order.subtotal,
    deliveryFee: order.delivery_fee,
    discount: order.discount,
    total: order.total,
    createdAt: order.created_at,
    items,
  });
});

// --- admin-only below ---

const listAll = asyncHandler(async (req, res) => {
  const { status, page, pageSize } = req.query;
  const limit = Math.min(Number(pageSize) || 50, 200);
  const offset = (Math.max(Number(page) || 1, 1) - 1) * limit;
  const orders = await orderModel.listForAdmin({ status, limit, offset });
  res.json({ orders, page: Number(page) || 1, pageSize: limit });
});

const updateStatus = asyncHandler(async (req, res) => {
  const ok = await orderModel.updateStatus(req.params.code, req.body.status);
  if (!ok) throw ApiError.notFound("Order not found.");
  res.json({ orderCode: req.params.code, status: req.body.status });
});

module.exports = { create, getByCode, listAll, updateStatus };
