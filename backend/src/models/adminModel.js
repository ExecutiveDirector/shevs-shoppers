const { pool } = require("../config/db");
const ApiError = require("../utils/ApiError");
const settingsModel = require("./settingsModel");

const STATUSES = ["pending", "confirmed", "dispatched", "delivered", "cancelled"];
const STOCK_REASONS = ["restock", "correction", "damaged", "return", "other"];

const money = (n) => Number(n) || 0;

// DATETIME columns take 'YYYY-MM-DD HH:MM:SS'; incoming values are ISO strings (UTC).
const toSqlDate = (v) => (v ? new Date(v).toISOString().slice(0, 19).replace("T", " ") : null);

/* ------------------------------------------------------------------ stats */

async function getStats() {
  const LOW_STOCK = (await settingsModel.getAll()).low_stock_threshold;
  // Dates are bucketed in Kenya time (UTC+3, no DST). Pin the session to UTC
  // so the +3h shift below is correct no matter where the DB server runs.
  const conn = await pool.getConnection();
  try {
    await conn.query("SET time_zone = '+00:00'");
    const local = "DATE_ADD(created_at, INTERVAL 3 HOUR)";
    const todayLocal = "DATE(DATE_ADD(UTC_TIMESTAMP(), INTERVAL 3 HOUR))";

    const [byStatus] = await conn.query(
      "SELECT status, COUNT(*) AS n, COALESCE(SUM(total),0) AS amount FROM orders GROUP BY status"
    );

    const [[periods]] = await conn.query(
      `SELECT
         COALESCE(SUM(CASE WHEN DATE(${local}) = ${todayLocal} THEN total END),0) AS today_revenue,
         SUM(DATE(${local}) = ${todayLocal}) AS today_orders,
         COALESCE(SUM(CASE WHEN DATE(${local}) >= DATE_SUB(${todayLocal}, INTERVAL 6 DAY) THEN total END),0) AS week_revenue,
         SUM(DATE(${local}) >= DATE_SUB(${todayLocal}, INTERVAL 6 DAY)) AS week_orders,
         COALESCE(SUM(CASE WHEN DATE(${local}) >= DATE_SUB(${todayLocal}, INTERVAL 29 DAY) THEN total END),0) AS month_revenue,
         SUM(DATE(${local}) >= DATE_SUB(${todayLocal}, INTERVAL 29 DAY)) AS month_orders,
         COALESCE(SUM(total),0) AS all_revenue,
         COUNT(*) AS all_orders
       FROM orders WHERE status <> 'cancelled'`
    );

    const [daily] = await conn.query(
      `SELECT DATE_FORMAT(${local}, '%Y-%m-%d') AS day, COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue
       FROM orders
       WHERE status <> 'cancelled' AND DATE(${local}) >= DATE_SUB(${todayLocal}, INTERVAL 13 DAY)
       GROUP BY day ORDER BY day`
    );
    const [[{ today }]] = await conn.query(`SELECT DATE_FORMAT(${todayLocal}, '%Y-%m-%d') AS today`);

    const [topProducts] = await conn.query(
      `SELECT oi.name_snapshot AS name, SUM(oi.qty) AS units, SUM(oi.line_total) AS revenue
       FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE o.status <> 'cancelled' AND DATE(DATE_ADD(o.created_at, INTERVAL 3 HOUR)) >= DATE_SUB(${todayLocal}, INTERVAL 29 DAY)
       GROUP BY oi.name_snapshot ORDER BY units DESC, revenue DESC LIMIT 5`
    );

    const [lowStock] = await conn.query(
      `SELECT id, name, emoji, image_url, stock, low_stock_threshold FROM products
       WHERE active = 1 AND stock <= COALESCE(low_stock_threshold, ?) ORDER BY stock ASC, name ASC LIMIT 10`,
      [LOW_STOCK]
    );
    const [[{ low_count }]] = await conn.query(
      "SELECT COUNT(*) AS low_count FROM products WHERE active = 1 AND stock <= COALESCE(low_stock_threshold, ?)",
      [LOW_STOCK]
    );

    const [[prodCounts]] = await conn.query(
      `SELECT COUNT(*) AS total, SUM(active = 1) AS active,
              COALESCE(SUM(stock), 0) AS units,
              COALESCE(SUM(stock * price), 0) AS retail_value,
              COALESCE(SUM(stock * cost_price), 0) AS cost_value,
              SUM(cost_price IS NULL) AS missing_cost,
              SUM(image_url IS NULL OR image_url = '') AS missing_image
       FROM products`
    );
    const [[{ customers }]] = await conn.query("SELECT COUNT(DISTINCT phone) AS customers FROM orders");

    const [recent] = await conn.query(
      `SELECT order_code, customer_name, status, total, created_at FROM orders ORDER BY created_at DESC LIMIT 6`
    );

    // Fill days with no orders so the chart has a continuous 14-day axis.
    const map = new Map(daily.map((d) => [d.day, d]));
    const series = [];
    const base = new Date(today + "T00:00:00Z");
    for (let i = 13; i >= 0; i--) {
      const d = new Date(base.getTime() - i * 86400000).toISOString().slice(0, 10);
      const row = map.get(d);
      series.push({ day: d, orders: row ? Number(row.orders) : 0, revenue: row ? money(row.revenue) : 0 });
    }

    const statusCounts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    byStatus.forEach((r) => (statusCounts[r.status] = Number(r.n)));

    return {
      statusCounts,
      today: { revenue: money(periods.today_revenue), orders: Number(periods.today_orders) || 0 },
      week: { revenue: money(periods.week_revenue), orders: Number(periods.week_orders) || 0 },
      month: { revenue: money(periods.month_revenue), orders: Number(periods.month_orders) || 0 },
      all: { revenue: money(periods.all_revenue), orders: Number(periods.all_orders) || 0 },
      averageOrder: Number(periods.all_orders) ? money(periods.all_revenue) / Number(periods.all_orders) : 0,
      customers: Number(customers) || 0,
      products: {
        total: Number(prodCounts.total) || 0,
        active: Number(prodCounts.active) || 0,
        units: Number(prodCounts.units) || 0,
        retailValue: money(prodCounts.retail_value),
        costValue: money(prodCounts.cost_value),
        missingCost: Number(prodCounts.missing_cost) || 0,
        missingImage: Number(prodCounts.missing_image) || 0,
      },
      lowStockThreshold: LOW_STOCK,
      lowStockCount: Number(low_count) || 0,
      lowStock,
      daily: series,
      topProducts: topProducts.map((p) => ({ name: p.name, units: Number(p.units), revenue: money(p.revenue) })),
      recentOrders: recent,
    };
  } finally {
    conn.release();
  }
}

/* ------------------------------------------------------------ stock log */

// Records a change that has already been applied to products.stock (reads the
// resulting level back so the history always shows the real number).
async function logStock(conn, productId, change, reason, note, orderCode) {
  const [[p]] = await conn.query("SELECT stock FROM products WHERE id = ?", [productId]);
  await conn.query(
    "INSERT INTO stock_log (product_id, change_qty, stock_after, reason, note, order_code) VALUES (?, ?, ?, ?, ?, ?)",
    [productId, change, p ? p.stock : 0, reason, note || null, orderCode || null]
  );
}

/* ----------------------------------------------------------------- orders */

function orderFilters({ status, q, from, to }) {
  const where = [];
  const params = [];
  if (status) {
    where.push("status = ?");
    params.push(status);
  }
  if (q) {
    where.push("(order_code LIKE ? OR customer_name LIKE ? OR phone LIKE ?)");
    params.push(`%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (from) {
    where.push("created_at >= ?");
    params.push(from);
  }
  if (to) {
    where.push("created_at < DATE_ADD(?, INTERVAL 1 DAY)");
    params.push(to);
  }
  return { sql: where.length ? "WHERE " + where.join(" AND ") : "", params };
}

async function listOrders({ status, q, from, to, limit, offset }) {
  const f = orderFilters({ status, q, from, to });
  const [rows] = await pool.query(
    `SELECT id, order_code, customer_name, phone, county, address, payment_method, status,
            subtotal, delivery_fee, discount, coupon_code, total, created_at
     FROM orders ${f.sql} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
    [...f.params, limit, offset]
  );
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM orders ${f.sql}`, f.params);
  return { orders: rows, total: Number(total) };
}

async function getOrder(code) {
  const [orders] = await pool.query("SELECT * FROM orders WHERE order_code = ?", [code]);
  if (!orders[0]) return null;
  const [items] = await pool.query(
    `SELECT product_id, name_snapshot, unit_price_snapshot, qty, line_total
     FROM order_items WHERE order_id = ? ORDER BY id`,
    [orders[0].id]
  );
  return { order: orders[0], items };
}

async function setOrderNote(code, note) {
  const [r] = await pool.query("UPDATE orders SET admin_note = ? WHERE order_code = ?", [note || null, code]);
  return r.affectedRows > 0;
}

/**
 * Changes an order's status. Stock is decremented when an order is placed, so
 * cancelling returns the units to stock, and re-opening a cancelled order
 * takes them out again (failing if there isn't enough left).
 */
async function setOrderStatus(code, status) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [rows] = await conn.query("SELECT id, status FROM orders WHERE order_code = ? FOR UPDATE", [code]);
    const order = rows[0];
    if (!order) {
      await conn.rollback();
      return null;
    }
    const prev = order.status;
    let restocked = 0;
    const backInStock = [];

    if (prev !== status && (status === "cancelled" || prev === "cancelled")) {
      const [items] = await conn.query(
        "SELECT product_id, name_snapshot, qty FROM order_items WHERE order_id = ? AND product_id IS NOT NULL",
        [order.id]
      );
      for (const it of items) {
        if (status === "cancelled") {
          const [[before]] = await conn.query("SELECT stock FROM products WHERE id = ?", [it.product_id]);
          if (before && before.stock <= 0) backInStock.push(it.product_id);
          await conn.query("UPDATE products SET stock = stock + ? WHERE id = ?", [it.qty, it.product_id]);
          await logStock(conn, it.product_id, it.qty, "cancel", null, code);
          restocked += it.qty;
        } else {
          const [[p]] = await conn.query("SELECT stock FROM products WHERE id = ? FOR UPDATE", [it.product_id]);
          if (p && p.stock < it.qty) {
            throw ApiError.conflict(
              `Can't re-open this order: only ${p.stock} of "${it.name_snapshot}" left in stock.`
            );
          }
          await conn.query("UPDATE products SET stock = stock - ? WHERE id = ?", [it.qty, it.product_id]);
          await logStock(conn, it.product_id, -it.qty, "reopen", null, code);
        }
      }
    }

    await conn.query("UPDATE orders SET status = ? WHERE id = ?", [status, order.id]);
    await conn.commit();
    for (const pid of backInStock) require("../utils/restock").notifyRestock(pid);
    return { previous: prev, status, restocked };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/* --------------------------------------------------------------- products */

const PRODUCT_SELECT = `
  SELECT p.id, p.category_id, c.name AS category_name, p.name, p.sku, p.brand, p.description,
         p.image_url, p.emoji, p.price, p.compare_at_price, p.cost_price, p.stock,
         p.low_stock_threshold, p.featured, p.tags, p.eta_label, p.rating, p.rating_count,
         p.active, p.created_at, p.updated_at
  FROM products p JOIN categories c ON c.id = p.category_id`;

const SORTS = {
  updated: "p.updated_at DESC, p.id DESC",
  newest: "p.id DESC",
  name: "p.name ASC",
  price_asc: "p.price ASC",
  price_desc: "p.price DESC",
  stock_asc: "p.stock ASC, p.name ASC",
  stock_desc: "p.stock DESC, p.name ASC",
};

async function listProducts({ q, categoryId, state, sort, limit, offset }) {
  const low = (await settingsModel.getAll()).low_stock_threshold;
  const where = [];
  const params = [];
  if (q) {
    where.push("(p.name LIKE ? OR p.sku LIKE ? OR p.brand LIKE ? OR p.tags LIKE ? OR c.name LIKE ?)");
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  if (categoryId) {
    where.push("p.category_id = ?");
    params.push(categoryId);
  }
  if (state === "active") where.push("p.active = 1");
  if (state === "hidden") where.push("p.active = 0");
  if (state === "featured") where.push("p.featured = 1");
  if (state === "low") {
    where.push("p.stock > 0 AND p.stock <= COALESCE(p.low_stock_threshold, ?)");
    params.push(low);
  }
  if (state === "out") where.push("p.stock <= 0");
  if (state === "noimage") where.push("(p.image_url IS NULL OR p.image_url = '')");
  if (state === "nocost") where.push("p.cost_price IS NULL");
  const w = where.length ? "WHERE " + where.join(" AND ") : "";

  const [rows] = await pool.query(
    `${PRODUCT_SELECT} ${w} ORDER BY ${SORTS[sort] || SORTS.updated} LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM products p JOIN categories c ON c.id = p.category_id ${w}`,
    params
  );
  return { products: rows, total: Number(total), lowStockThreshold: low };
}

async function getProduct(id) {
  const [rows] = await pool.query(`${PRODUCT_SELECT} WHERE p.id = ?`, [id]);
  return rows[0] || null;
}

// Everything the product editor shows: the record, sales performance and stock history.
async function getProductDetail(id) {
  const product = await getProduct(id);
  if (!product) return null;
  const [[sales]] = await pool.query(
    `SELECT COALESCE(SUM(oi.qty),0) AS units, COALESCE(SUM(oi.line_total),0) AS revenue,
            COALESCE(SUM(CASE WHEN o.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN oi.qty END),0) AS units30,
            COALESCE(SUM(CASE WHEN o.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN oi.line_total END),0) AS revenue30
     FROM order_items oi JOIN orders o ON o.id = oi.order_id
     WHERE oi.product_id = ? AND o.status <> 'cancelled'`,
    [id]
  );
  const [history] = await pool.query(
    `SELECT id, change_qty, stock_after, reason, note, order_code, created_at
     FROM stock_log WHERE product_id = ? ORDER BY id DESC LIMIT 25`,
    [id]
  );
  return {
    product,
    sales: {
      units: Number(sales.units),
      revenue: money(sales.revenue),
      units30: Number(sales.units30),
      revenue30: money(sales.revenue30),
    },
    history,
  };
}

async function assertCategory(categoryId) {
  const [rows] = await pool.query("SELECT id FROM categories WHERE id = ?", [categoryId]);
  if (!rows[0]) throw ApiError.badRequest("That category doesn't exist.");
}

// "" and whitespace-only text become NULL so optional columns stay clean (and SKU uniqueness works).
const clean = (v) => {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
};
const normaliseTags = (v) => {
  const t = clean(v);
  if (!t) return t;
  return [...new Set(t.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean))].join(", ").slice(0, 255) || null;
};

async function guardSku(fn) {
  try {
    return await fn();
  } catch (err) {
    if (err && err.code === "ER_DUP_ENTRY") throw ApiError.conflict("Another product already uses that SKU.");
    throw err;
  }
}

async function createProduct(d) {
  await assertCategory(d.categoryId);
  const compareAt = d.compareAtPrice != null ? d.compareAtPrice : d.price;
  if (compareAt < d.price) throw ApiError.badRequest("The 'was' price can't be lower than the selling price.");
  const id = await guardSku(async () => {
    const [r] = await pool.query(
      `INSERT INTO products (category_id, name, sku, brand, description, image_url, emoji, price,
                             compare_at_price, cost_price, stock, low_stock_threshold, featured, tags, eta_label, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        d.categoryId, d.name, clean(d.sku) ?? null, clean(d.brand) ?? null, clean(d.description) ?? null,
        clean(d.imageUrl) ?? null, d.emoji || "", d.price, compareAt, d.costPrice ?? null, d.stock ?? 0,
        d.lowStockThreshold ?? null, d.featured ? 1 : 0, normaliseTags(d.tags) ?? null,
        d.etaLabel || "2–4 days", d.active === false ? 0 : 1,
      ]
    );
    return r.insertId;
  });
  if ((d.stock ?? 0) > 0) {
    await pool.query(
      "INSERT INTO stock_log (product_id, change_qty, stock_after, reason, note) VALUES (?, ?, ?, 'restock', 'Opening stock')",
      [id, d.stock, d.stock]
    );
  }
  return getProduct(id);
}

const PRODUCT_COLUMNS = {
  categoryId: "category_id",
  name: "name",
  sku: "sku",
  brand: "brand",
  description: "description",
  imageUrl: "image_url",
  emoji: "emoji",
  price: "price",
  compareAtPrice: "compare_at_price",
  costPrice: "cost_price",
  lowStockThreshold: "low_stock_threshold",
  featured: "featured",
  tags: "tags",
  etaLabel: "eta_label",
  active: "active",
};
const TEXT_FIELDS = ["sku", "brand", "description", "imageUrl"];

async function updateProduct(id, d) {
  const existing = await getProduct(id);
  if (!existing) return null;
  if (d.categoryId != null) await assertCategory(d.categoryId);

  const price = d.price != null ? d.price : Number(existing.price);
  const compareAt = d.compareAtPrice != null ? d.compareAtPrice : Number(existing.compare_at_price);
  if (compareAt < price) {
    throw ApiError.badRequest("The 'was' price can't be lower than the selling price.");
  }

  const sets = [];
  const params = [];
  for (const [key, col] of Object.entries(PRODUCT_COLUMNS)) {
    if (d[key] === undefined) continue;
    let v = d[key];
    if (TEXT_FIELDS.includes(key)) v = clean(v);
    else if (key === "tags") v = normaliseTags(v);
    else if (key === "active" || key === "featured") v = v ? 1 : 0;
    sets.push(`${col} = ?`);
    params.push(v);
  }
  if (sets.length) {
    await guardSku(() => pool.query(`UPDATE products SET ${sets.join(", ")} WHERE id = ?`, [...params, id]));
  }
  if (d.stock !== undefined && Number(d.stock) !== existing.stock) {
    await adjustStock(id, { mode: "set", qty: d.stock, reason: "correction", note: "Edited in product form" });
  }
  return getProduct(id);
}

/**
 * Changes stock and records why. mode "add" applies a +/- difference,
 * "set" counts to an exact figure. Runs under a row lock so it can't race a sale.
 */
async function adjustStock(id, { mode, qty, reason, note }) {
  const conn = await pool.getConnection();
  let wasSoldOut = false;
  try {
    await conn.beginTransaction();
    const [[p]] = await conn.query("SELECT id, stock FROM products WHERE id = ? FOR UPDATE", [id]);
    if (!p) {
      await conn.rollback();
      return null;
    }
    const next = mode === "set" ? Number(qty) : p.stock + Number(qty);
    if (next < 0) throw ApiError.badRequest(`That would take stock below zero (currently ${p.stock}).`);
    const change = next - p.stock;
    wasSoldOut = p.stock <= 0 && next > 0;
    if (change !== 0) {
      await conn.query("UPDATE products SET stock = ? WHERE id = ?", [next, id]);
      await conn.query(
        "INSERT INTO stock_log (product_id, change_qty, stock_after, reason, note) VALUES (?, ?, ?, ?, ?)",
        [id, change, next, STOCK_REASONS.includes(reason) ? reason : "other", note ? String(note).slice(0, 200) : null]
      );
    }
    await conn.commit();
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
  if (wasSoldOut) require("../utils/restock").notifyRestock(id);
  return getProduct(id);
}

async function duplicateProduct(id) {
  const p = await getProduct(id);
  if (!p) return null;
  // The copy starts hidden with no stock and no SKU so it can't clash or sell by accident.
  const [r] = await pool.query(
    `INSERT INTO products (category_id, name, brand, description, image_url, emoji, price, compare_at_price,
                           cost_price, stock, low_stock_threshold, featured, tags, eta_label, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, ?, ?, 0)`,
    [p.category_id, `${p.name} (copy)`.slice(0, 160), p.brand, p.description, p.image_url, p.emoji, p.price,
     p.compare_at_price, p.cost_price, p.low_stock_threshold, p.tags, p.eta_label]
  );
  return getProduct(r.insertId);
}

async function bulkProducts(ids, action, categoryId) {
  if (!ids.length) return 0;
  const marks = ids.map(() => "?").join(",");
  if (action === "delete") {
    const [r] = await pool.query(`DELETE FROM products WHERE id IN (${marks})`, ids);
    return r.affectedRows;
  }
  const sets = {
    show: ["active = 1"],
    hide: ["active = 0"],
    feature: ["featured = 1"],
    unfeature: ["featured = 0"],
  }[action];
  if (action === "category") {
    await assertCategory(categoryId);
    const [r] = await pool.query(`UPDATE products SET category_id = ? WHERE id IN (${marks})`, [categoryId, ...ids]);
    return r.affectedRows;
  }
  if (!sets) throw ApiError.badRequest("Unknown bulk action.");
  const [r] = await pool.query(`UPDATE products SET ${sets[0]} WHERE id IN (${marks})`, ids);
  return r.affectedRows;
}

async function deleteProduct(id) {
  // Order history keeps its own name/price snapshots and product_id is
  // ON DELETE SET NULL, so a hard delete never damages past orders.
  const [r] = await pool.query("DELETE FROM products WHERE id = ?", [id]);
  return r.affectedRows > 0;
}

/* ------------------------------------------------------------- categories */

async function listCategories() {
  const [rows] = await pool.query(
    `SELECT c.id, c.name, c.icon, c.sort_order,
            (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
     FROM categories c ORDER BY c.sort_order ASC, c.id ASC`
  );
  return rows;
}

async function createCategory({ name, icon, sortOrder }) {
  let order = sortOrder;
  if (order == null) {
    const [[{ m }]] = await pool.query("SELECT COALESCE(MAX(sort_order),0) + 1 AS m FROM categories");
    order = m;
  }
  const [r] = await pool.query("INSERT INTO categories (name, icon, sort_order) VALUES (?, ?, ?)", [name, icon, order]);
  const [rows] = await pool.query("SELECT id, name, icon, sort_order, 0 AS product_count FROM categories WHERE id = ?", [r.insertId]);
  return rows[0];
}

async function updateCategory(id, d) {
  const sets = [];
  const params = [];
  if (d.name !== undefined) (sets.push("name = ?"), params.push(d.name));
  if (d.icon !== undefined) (sets.push("icon = ?"), params.push(d.icon));
  if (d.sortOrder !== undefined) (sets.push("sort_order = ?"), params.push(d.sortOrder));
  if (sets.length) {
    const [r] = await pool.query(`UPDATE categories SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
    if (!r.affectedRows) {
      const [chk] = await pool.query("SELECT id FROM categories WHERE id = ?", [id]);
      if (!chk[0]) return null;
    }
  }
  const [rows] = await pool.query(
    `SELECT c.id, c.name, c.icon, c.sort_order,
            (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) AS product_count
     FROM categories c WHERE c.id = ?`,
    [id]
  );
  return rows[0] || null;
}

async function deleteCategory(id) {
  const [[{ n }]] = await pool.query("SELECT COUNT(*) AS n FROM products WHERE category_id = ?", [id]);
  if (n > 0) {
    throw ApiError.conflict(`This category still has ${n} product${n === 1 ? "" : "s"}. Move or delete them first.`);
  }
  const [r] = await pool.query("DELETE FROM categories WHERE id = ?", [id]);
  return r.affectedRows > 0;
}

/* ---------------------------------------------------------------- coupons */

async function listCoupons() {
  const [rows] = await pool.query(
    `SELECT c.id, c.code, c.discount_amount, c.min_subtotal, c.active, c.expires_at,
            (SELECT COUNT(*) FROM orders o WHERE o.coupon_code = c.code) AS times_used
     FROM coupons c ORDER BY c.id DESC`
  );
  return rows;
}

async function getCoupon(id) {
  const [rows] = await pool.query(
    `SELECT c.id, c.code, c.discount_amount, c.min_subtotal, c.active, c.expires_at,
            (SELECT COUNT(*) FROM orders o WHERE o.coupon_code = c.code) AS times_used
     FROM coupons c WHERE c.id = ?`,
    [id]
  );
  return rows[0] || null;
}

async function createCoupon(d) {
  const [r] = await pool.query(
    "INSERT INTO coupons (code, discount_amount, min_subtotal, active, expires_at) VALUES (?, ?, ?, ?, ?)",
    [d.code.toUpperCase(), d.discountAmount, d.minSubtotal ?? 0, d.active === false ? 0 : 1, toSqlDate(d.expiresAt)]
  );
  return getCoupon(r.insertId);
}

async function updateCoupon(id, d) {
  const map = { code: "code", discountAmount: "discount_amount", minSubtotal: "min_subtotal", active: "active", expiresAt: "expires_at" };
  const sets = [];
  const params = [];
  for (const [key, col] of Object.entries(map)) {
    if (d[key] === undefined) continue;
    sets.push(`${col} = ?`);
    let v = d[key];
    if (key === "code") v = String(v).toUpperCase();
    if (key === "active") v = v ? 1 : 0;
    if (key === "expiresAt") v = toSqlDate(v);
    params.push(v);
  }
  if (sets.length) await pool.query(`UPDATE coupons SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
  return getCoupon(id);
}

async function deleteCoupon(id) {
  const [r] = await pool.query("DELETE FROM coupons WHERE id = ?", [id]);
  return r.affectedRows > 0;
}

/* -------------------------------------------------------------- customers */

async function listCustomers({ q, limit, offset }) {
  const where = [];
  const params = [];
  if (q) {
    where.push("(customer_name LIKE ? OR phone LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }
  const w = where.length ? "WHERE " + where.join(" AND ") : "";
  const [rows] = await pool.query(
    `SELECT phone,
            SUBSTRING_INDEX(GROUP_CONCAT(customer_name ORDER BY created_at DESC SEPARATOR '\n'), '\n', 1) AS name,
            SUBSTRING_INDEX(GROUP_CONCAT(county ORDER BY created_at DESC SEPARATOR '\n'), '\n', 1) AS county,
            COUNT(*) AS orders,
            COALESCE(SUM(CASE WHEN status <> 'cancelled' THEN total END),0) AS spent,
            MAX(created_at) AS last_order
     FROM orders ${w}
     GROUP BY phone ORDER BY last_order DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(DISTINCT phone) AS total FROM orders ${w}`,
    params
  );
  return { customers: rows.map((r) => ({ ...r, spent: money(r.spent), orders: Number(r.orders) })), total: Number(total) };
}

module.exports = {
  STATUSES,
  getStats,
  listOrders,
  getOrder,
  setOrderStatus,
  setOrderNote,
  listProducts,
  getProduct,
  getProductDetail,
  createProduct,
  updateProduct,
  adjustStock,
  duplicateProduct,
  bulkProducts,
  deleteProduct,
  listCategories,
  createCategory,
  updateCategory,
  deleteCategory,
  listCoupons,
  createCoupon,
  updateCoupon,
  deleteCoupon,
  listCustomers,
};
