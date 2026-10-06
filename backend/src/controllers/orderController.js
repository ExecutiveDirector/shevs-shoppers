const orderModel = require("../models/orderModel");
const settingsModel = require("../models/settingsModel");
const { buildOrderWhatsAppLink } = require("../utils/whatsapp");
const mailer = require("../utils/mailer");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");

const create = asyncHandler(async (req, res) => {
  const { customerName, phone, customerEmail, county, address, paymentMethod, couponCode, items } = req.body;

  const { order, items: lineItems } = await orderModel.createOrder({
    customerName,
    phone,
    customerEmail: customerEmail || null,
    county,
    address,
    paymentMethod,
    couponCode: couponCode || null,
    items,
  });

  const settings = await settingsModel.getAll();
  const whatsappUrl = buildOrderWhatsAppLink(order, lineItems, settings.whatsapp_number, settings.shop_name);

  // Fire-and-forget: the order is already saved, so a mail hiccup must never fail checkout.
  if (settings.owner_email) {
    const m = mailer.orderEmail(order, lineItems, settings.shop_name, process.env.ADMIN_URL || "");
    mailer.send({ to: settings.owner_email, ...m }).catch(() => {});
  }

  if (order.customer_email) {
    mailer.send({ to: order.customer_email, ...mailer.receiptEmail(order, lineItems, settings.shop_name) }).catch(() => {});
  }

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

module.exports = { create, getByCode };
