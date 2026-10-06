const adminModel = require("../models/adminModel");
const settingsModel = require("../models/settingsModel");
const imageModel = require("../models/imageModel");
const mailer = require("../utils/mailer");
const reportModel = require("../models/reportModel");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");

const paging = (req, def = 25, max = 200) => {
  const limit = Math.min(Math.max(Number(req.query.pageSize) || def, 1), max);
  const page = Math.max(Number(req.query.page) || 1, 1);
  return { limit, page, offset: (page - 1) * limit };
};

const idParam = (req) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw ApiError.badRequest("Invalid id.");
  return id;
};

const dateOnly = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

// Turns a duplicate-key DB error into a friendly 409.
async function guardDuplicate(fn, message) {
  try {
    return await fn();
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") throw ApiError.conflict(message);
    throw err;
  }
}

const stats = asyncHandler(async (req, res) => res.json(await adminModel.getStats()));

/* orders */
const listOrders = asyncHandler(async (req, res) => {
  const { limit, page, offset } = paging(req);
  const status = adminModel.STATUSES.includes(req.query.status) ? req.query.status : null;
  const q = (req.query.q || "").toString().trim().slice(0, 60) || null;
  const { orders, total } = await adminModel.listOrders({
    status,
    q,
    from: dateOnly(req.query.from),
    to: dateOnly(req.query.to),
    limit,
    offset,
  });
  res.json({ orders, total, page, pageSize: limit });
});

const getOrder = asyncHandler(async (req, res) => {
  const result = await adminModel.getOrder(req.params.code);
  if (!result) throw ApiError.notFound("Order not found.");
  res.json(result);
});

const setOrderStatus = asyncHandler(async (req, res) => {
  const result = await adminModel.setOrderStatus(req.params.code, req.body.status);
  if (!result) throw ApiError.notFound("Order not found.");
  // Tell the customer by email too when they gave an address (WhatsApp is the owner's manual button).
  if (result.previous !== result.status && mailer.configured()) {
    const found = await adminModel.getOrder(req.params.code);
    if (found && found.order.customer_email) {
      const shop = (await settingsModel.getAll()).shop_name;
      const m = mailer.statusEmail(found.order, result.status, shop);
      if (m) mailer.send({ to: found.order.customer_email, ...m }).catch(() => {});
    }
  }
  res.json({ orderCode: req.params.code, ...result });
});

/* products */
const listProducts = asyncHandler(async (req, res) => {
  const { limit, page, offset } = paging(req, 25, 100);
  const state = ["active", "hidden", "featured", "low", "out", "noimage", "nocost"].includes(req.query.state) ? req.query.state : null;
  const out = await adminModel.listProducts({
    q: (req.query.q || "").toString().trim().slice(0, 60) || null,
    categoryId: Number(req.query.category) || null,
    state,
    sort: req.query.sort,
    limit,
    offset,
  });
  res.json({ ...out, page, pageSize: limit });
});

const getProduct = asyncHandler(async (req, res) => {
  const detail = await adminModel.getProductDetail(idParam(req));
  if (!detail) throw ApiError.notFound("Product not found.");
  res.json(detail);
});

const adjustStock = asyncHandler(async (req, res) => {
  const product = await adminModel.adjustStock(idParam(req), req.body);
  if (!product) throw ApiError.notFound("Product not found.");
  res.json({ product });
});

const duplicateProduct = asyncHandler(async (req, res) => {
  const product = await adminModel.duplicateProduct(idParam(req));
  if (!product) throw ApiError.notFound("Product not found.");
  res.status(201).json({ product });
});

const bulkProducts = asyncHandler(async (req, res) => {
  const affected = await adminModel.bulkProducts(req.body.ids, req.body.action, req.body.categoryId);
  res.json({ affected });
});

const setOrderNote = asyncHandler(async (req, res) => {
  const ok = await adminModel.setOrderNote(req.params.code, req.body.note);
  if (!ok) throw ApiError.notFound("Order not found.");
  res.json({ saved: true });
});

const uploadImage = asyncHandler(async (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) throw ApiError.badRequest("Choose an image file to upload.");
  let img;
  try { img = await imageModel.create(req.body); }
  catch { throw ApiError.badRequest("That file isn't a usable image. Use a JPG, PNG or WebP photo."); }
  // Absolute URL so the storefront (a different domain) can load it directly.
  const origin = process.env.PUBLIC_API_URL || `${req.protocol}://${req.get("host")}`;
  res.status(201).json({ id: img.id, url: `${origin.replace(/\/$/, "")}/api/images/${img.id}.webp`, width: img.width, height: img.height });
});

const testEmail = asyncHandler(async (req, res) => {
  const s = await settingsModel.getAll();
  if (!s.owner_email) throw ApiError.badRequest("Save an order-alert email address first.");
  const r = await mailer.send({ to: s.owner_email, subject: `Test alert from ${s.shop_name}`, text: "Order alerts are working. You'll get an email like this for every new order.", html: `<p>✅ Order alerts are working for <b>${s.shop_name.replace(/[<>&]/g, "")}</b>. You'll get an email like this for every new order.</p>` });
  if (!r.ok) throw ApiError.badRequest(`Couldn't send: ${r.reason}.`);
  res.json({ ok: true, to: s.owner_email });
});

const salesReport = asyncHandler(async (req, res) => res.json(await reportModel.sales(req.query)));

const csvCell = (v) => {
  let t = v == null ? "" : String(v);
  // Stop spreadsheet formula injection from customer-typed names/addresses.
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};
const exportCsv = asyncHandler(async (req, res) => {
  const { from, to, rows } = await reportModel.exportRows(req.query);
  const cols = ["order_code", "placed", "status", "customer_name", "phone", "county", "payment_method", "product", "qty", "unit_price", "line_total", "delivery_fee", "discount", "total"];
  const csv = "\ufeff" + [cols.join(","), ...rows.map((r) => cols.map((c) => csvCell(r[c])).join(","))].join("\r\n");
  res.set({ "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="orders-${from}-to-${to}.csv"` });
  res.send(csv);
});

const getSettings = asyncHandler(async (req, res) => res.json({ settings: await settingsModel.getAll() }));

const updateSettings = asyncHandler(async (req, res) => {
  res.json({ settings: await settingsModel.update(req.body) });
});

const createProduct = asyncHandler(async (req, res) => {
  res.status(201).json({ product: await adminModel.createProduct(req.body) });
});

const updateProduct = asyncHandler(async (req, res) => {
  const product = await adminModel.updateProduct(idParam(req), req.body);
  if (!product) throw ApiError.notFound("Product not found.");
  res.json({ product });
});

const deleteProduct = asyncHandler(async (req, res) => {
  const ok = await adminModel.deleteProduct(idParam(req));
  if (!ok) throw ApiError.notFound("Product not found.");
  res.json({ deleted: true });
});

/* categories */
const listCategories = asyncHandler(async (req, res) => res.json({ categories: await adminModel.listCategories() }));

const createCategory = asyncHandler(async (req, res) => {
  res.status(201).json({ category: await adminModel.createCategory(req.body) });
});

const updateCategory = asyncHandler(async (req, res) => {
  const category = await adminModel.updateCategory(idParam(req), req.body);
  if (!category) throw ApiError.notFound("Category not found.");
  res.json({ category });
});

const deleteCategory = asyncHandler(async (req, res) => {
  const ok = await adminModel.deleteCategory(idParam(req));
  if (!ok) throw ApiError.notFound("Category not found.");
  res.json({ deleted: true });
});

/* coupons */
const listCoupons = asyncHandler(async (req, res) => res.json({ coupons: await adminModel.listCoupons() }));

const createCoupon = asyncHandler(async (req, res) => {
  const coupon = await guardDuplicate(() => adminModel.createCoupon(req.body), "A coupon with that code already exists.");
  res.status(201).json({ coupon });
});

const updateCoupon = asyncHandler(async (req, res) => {
  const coupon = await guardDuplicate(() => adminModel.updateCoupon(idParam(req), req.body), "A coupon with that code already exists.");
  if (!coupon) throw ApiError.notFound("Coupon not found.");
  res.json({ coupon });
});

const deleteCoupon = asyncHandler(async (req, res) => {
  const ok = await adminModel.deleteCoupon(idParam(req));
  if (!ok) throw ApiError.notFound("Coupon not found.");
  res.json({ deleted: true });
});

/* customers */
const listCustomers = asyncHandler(async (req, res) => {
  const { limit, page, offset } = paging(req, 25, 100);
  const out = await adminModel.listCustomers({
    q: (req.query.q || "").toString().trim().slice(0, 60) || null,
    limit,
    offset,
  });
  res.json({ ...out, page, pageSize: limit });
});

module.exports = {
  stats, listOrders, getOrder, setOrderStatus, setOrderNote,
  listProducts, getProduct, createProduct, updateProduct, deleteProduct,
  adjustStock, duplicateProduct, bulkProducts,
  salesReport, exportCsv, uploadImage, testEmail, getSettings, updateSettings,
  listCategories, createCategory, updateCategory, deleteCategory,
  listCoupons, createCoupon, updateCoupon, deleteCoupon,
  listCustomers,
};
