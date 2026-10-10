const { pool } = require("../config/db");
const promoModel = require("./promoModel");
const ApiError = require("../utils/ApiError");

const digits = (s) => String(s || "").replace(/\D/g, "");
// Compare phones by their last 9 digits so 0712…, 254712… and +254712… all match.
const samePhone = (a, b) => digits(a).slice(-9) === digits(b).slice(-9) && digits(a).length >= 9;

/* ------------------------------------------------------- back in stock */

async function addAlert(productId, contact) {
  const [[p]] = await pool.query("SELECT id FROM products WHERE id = ? AND active = 1", [productId]);
  if (!p) throw ApiError.notFound("Product not found.");
  const isEmail = contact.includes("@");
  const value = isEmail ? contact.toLowerCase() : "254" + digits(contact).slice(-9);
  await pool.query("INSERT IGNORE INTO stock_alerts (product_id, contact, kind) VALUES (?, ?, ?)", [productId, value, isEmail ? "email" : "phone"]);
}

async function listAlerts() {
  const [rows] = await pool.query(
    `SELECT a.id, a.product_id, p.name AS product_name, p.stock, a.contact, a.kind, a.created_at, a.notified_at
     FROM stock_alerts a JOIN products p ON p.id = a.product_id
     ORDER BY (a.notified_at IS NULL) DESC, a.created_at DESC LIMIT 500`
  );
  return rows;
}

async function pendingForProduct(productId) {
  const [rows] = await pool.query("SELECT id, contact, kind FROM stock_alerts WHERE product_id = ? AND notified_at IS NULL", [productId]);
  return rows;
}
async function markAlerts(ids) {
  if (!ids.length) return;
  await pool.query("UPDATE stock_alerts SET notified_at = NOW() WHERE id IN (?)", [ids]);
}
async function markAlert(id) {
  const [r] = await pool.query("UPDATE stock_alerts SET notified_at = NOW() WHERE id = ?", [id]);
  return r.affectedRows > 0;
}
async function deleteAlert(id) {
  const [r] = await pool.query("DELETE FROM stock_alerts WHERE id = ?", [id]);
  return r.affectedRows > 0;
}
async function pendingCount() {
  const [[r]] = await pool.query("SELECT COUNT(*) AS n FROM stock_alerts WHERE notified_at IS NULL");
  return r.n;
}

/* ------------------------------------------------------------- reviews */

async function recalcRating(productId) {
  const [[r]] = await pool.query("SELECT COUNT(*) AS n, COALESCE(AVG(rating),0) AS avg FROM reviews WHERE product_id = ? AND status = 'approved'", [productId]);
  await pool.query("UPDATE products SET rating = ?, rating_count = ? WHERE id = ?", [Math.round(Number(r.avg) * 10) / 10, r.n, productId]);
}

async function listApproved(productId) {
  const [rows] = await pool.query(
    "SELECT id, name, rating, comment, created_at FROM reviews WHERE product_id = ? AND status = 'approved' ORDER BY created_at DESC LIMIT 50",
    [productId]
  );
  return rows;
}

// Only someone who actually received this product can review it: order code + phone must match
// a delivered order containing it. That's what makes the reviews trustworthy.
async function insertReview(order, productId, { name, rating, comment }) {
  if (order.status !== "delivered") throw ApiError.badRequest("You can review a product once your order has been delivered.");
  const [[item]] = await pool.query("SELECT id FROM order_items WHERE order_id = ? AND product_id = ?", [order.id, productId]);
  if (!item) throw ApiError.badRequest("That product isn't in this order.");
  try {
    await pool.query("INSERT INTO reviews (product_id, order_id, name, rating, comment) VALUES (?, ?, ?, ?, ?)", [productId, order.id, name, rating, comment || null]);
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") throw ApiError.conflict("You've already reviewed this product for this order.");
    throw err;
  }
}

async function submitReview(productId, { orderCode, phone, name, rating, comment }) {
  const [orders] = await pool.query("SELECT id, phone, status FROM orders WHERE order_code = ?", [String(orderCode).toUpperCase()]);
  const order = orders[0];
  if (!order || !samePhone(order.phone, phone)) throw ApiError.badRequest("We couldn't match that order number and phone number.");
  await insertReview(order, productId, { name, rating, comment });
}

// Signed-in customers don't need to type the order number or phone: the order must be on their account.
async function submitReviewForUser(user, { orderCode, productId, rating, comment }) {
  const [orders] = await pool.query("SELECT id, status FROM orders WHERE order_code = ? AND user_id = ?", [String(orderCode).toUpperCase(), user.id]);
  if (!orders[0]) throw ApiError.badRequest("We couldn't find that order on your account.");
  await insertReview(orders[0], productId, { name: user.name, rating, comment });
}

// The items of one delivered order, with whether each has been reviewed already.
async function itemsForReview(orderId) {
  const [rows] = await pool.query(
    `SELECT oi.product_id, MIN(oi.name_snapshot) AS name, MIN(p.image_url) AS image_url, MIN(p.emoji) AS emoji,
            (SELECT COUNT(*) FROM reviews r WHERE r.order_id = oi.order_id AND r.product_id = oi.product_id) AS reviewed
     FROM order_items oi JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = ? GROUP BY oi.product_id, oi.order_id ORDER BY MIN(oi.id)`, [orderId]);
  return rows.map((r) => ({ productId: r.product_id, name: r.name, imageUrl: r.image_url, emoji: r.emoji, reviewed: r.reviewed > 0 }));
}

// Guest: order number + phone → the items they can review.
async function reviewableByOrder(orderCode, phone) {
  const [orders] = await pool.query("SELECT id, order_code, phone, status, customer_name, created_at FROM orders WHERE order_code = ?", [String(orderCode).toUpperCase()]);
  const o = orders[0];
  if (!o || !samePhone(o.phone, phone)) throw ApiError.badRequest("We couldn't match that order number and phone number.");
  if (o.status !== "delivered") throw ApiError.badRequest("You can review once your order has been delivered.");
  return { orderCode: o.order_code, name: o.customer_name, createdAt: o.created_at, items: await itemsForReview(o.id) };
}

// Signed in: every delivered order on the account, each with its items.
async function reviewableForUser(userId) {
  const [orders] = await pool.query("SELECT id, order_code, created_at FROM orders WHERE user_id = ? AND status = 'delivered' ORDER BY created_at DESC, id DESC LIMIT 50", [userId]);
  const out = [];
  for (const o of orders) out.push({ orderCode: o.order_code, createdAt: o.created_at, items: await itemsForReview(o.id) });
  return out;
}

async function listReviews({ status }) {
  const where = status ? "WHERE r.status = ?" : "";
  const [rows] = await pool.query(
    `SELECT r.id, r.product_id, p.name AS product_name, r.name, r.rating, r.comment, r.status, r.created_at, o.order_code
     FROM reviews r JOIN products p ON p.id = r.product_id JOIN orders o ON o.id = r.order_id
     ${where} ORDER BY (r.status = 'pending') DESC, r.created_at DESC LIMIT 300`,
    status ? [status] : []
  );
  return rows;
}
async function setReviewStatus(id, status) {
  const [[r]] = await pool.query("SELECT product_id FROM reviews WHERE id = ?", [id]);
  if (!r) return false;
  await pool.query("UPDATE reviews SET status = ? WHERE id = ?", [status, id]);
  await recalcRating(r.product_id);
  return true;
}
async function deleteReview(id) {
  const [[r]] = await pool.query("SELECT product_id FROM reviews WHERE id = ?", [id]);
  if (!r) return false;
  await pool.query("DELETE FROM reviews WHERE id = ?", [id]);
  await recalcRating(r.product_id);
  return true;
}
async function pendingReviews() {
  const [[r]] = await pool.query("SELECT COUNT(*) AS n FROM reviews WHERE status = 'pending'");
  return r.n;
}

/* ------------------------------------------------------------- banners */

const dt = (v) => (v ? String(v).replace("T", " ").slice(0, 19) : null);

async function publicBanners() {
  const [rows] = await pool.query(
    `SELECT id, title, subtitle, image_url, link_type, link_id FROM banners
     WHERE active = 1 AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP()) AND (ends_at IS NULL OR ends_at > UTC_TIMESTAMP())
     ORDER BY sort_order, id DESC LIMIT 8`
  );
  return rows;
}
async function listBanners() {
  const [rows] = await pool.query("SELECT * FROM banners ORDER BY sort_order, id DESC");
  return rows;
}
async function saveBanner(id, d) {
  const vals = [d.title, d.subtitle || null, d.imageUrl || null, d.linkType || "none", d.linkType && d.linkType !== "none" ? d.linkId || null : null, dt(d.startsAt), dt(d.endsAt), d.active === false ? 0 : 1, d.sortOrder || 0];
  if (id) {
    const [r] = await pool.query("UPDATE banners SET title=?, subtitle=?, image_url=?, link_type=?, link_id=?, starts_at=?, ends_at=?, active=?, sort_order=? WHERE id=?", [...vals, id]);
    return r.affectedRows > 0;
  }
  const [r] = await pool.query("INSERT INTO banners (title, subtitle, image_url, link_type, link_id, starts_at, ends_at, active, sort_order) VALUES (?,?,?,?,?,?,?,?,?)", vals);
  return r.insertId;
}
async function deleteBanner(id) {
  const [r] = await pool.query("DELETE FROM banners WHERE id = ?", [id]);
  return r.affectedRows > 0;
}

/* ---------------------------------------------------------- promotions */

async function listPromotions() {
  const [rows] = await pool.query(
    `SELECT pr.*, (pr.active = 1 AND (pr.starts_at IS NULL OR pr.starts_at <= UTC_TIMESTAMP()) AND (pr.ends_at IS NULL OR pr.ends_at > UTC_TIMESTAMP())) AS live,
            CASE pr.scope WHEN 'category' THEN (SELECT name FROM categories WHERE id = pr.scope_id)
                          WHEN 'product' THEN (SELECT name FROM products WHERE id = pr.scope_id) ELSE NULL END AS scope_name
     FROM promotions pr ORDER BY live DESC, pr.id DESC`
  );
  return rows;
}
async function savePromotion(id, d) {
  const scopeId = d.scope === "all" ? null : d.scopeId;
  if (d.scope !== "all" && !scopeId) throw ApiError.badRequest("Choose which category or product this applies to.");
  const vals = [d.name, d.percentOff, d.scope, scopeId, d.minQty || 1, dt(d.startsAt), dt(d.endsAt), d.active === false ? 0 : 1];
  let out;
  if (id) {
    const [r] = await pool.query("UPDATE promotions SET name=?, percent_off=?, scope=?, scope_id=?, min_qty=?, starts_at=?, ends_at=?, active=? WHERE id=?", [...vals, id]);
    out = r.affectedRows > 0;
  } else {
    const [r] = await pool.query("INSERT INTO promotions (name, percent_off, scope, scope_id, min_qty, starts_at, ends_at, active) VALUES (?,?,?,?,?,?,?,?)", vals);
    out = r.insertId;
  }
  promoModel.clearCache();
  return out;
}
async function deletePromotion(id) {
  const [r] = await pool.query("DELETE FROM promotions WHERE id = ?", [id]);
  promoModel.clearCache();
  return r.affectedRows > 0;
}

module.exports = {
  addAlert, listAlerts, pendingForProduct, markAlerts, markAlert, deleteAlert, pendingCount,
  listApproved, submitReview, submitReviewForUser, reviewableByOrder, reviewableForUser, listReviews, setReviewStatus, deleteReview, pendingReviews,
  publicBanners, listBanners, saveBanner, deleteBanner,
  listPromotions, savePromotion, deletePromotion,
};
