const { pool } = require("../config/db");
const ApiError = require("../utils/ApiError");

const STATUSES = ["pending", "confirmed", "dispatched", "delivered", "cancelled"];
const LOW_STOCK = 5;

const money = (n) => Number(n) || 0;

// DATETIME columns take 'YYYY-MM-DD HH:MM:SS'; incoming values are ISO strings (UTC).
const toSqlDate = (v) => (v ? new Date(v).toISOString().slice(0, 19).replace("T", " ") : null);

/* ------------------------------------------------------------------ stats */

async function getStats() {
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
      `SELECT id, name, emoji, stock FROM products WHERE active = 1 AND stock <= ? ORDER BY stock ASC, name ASC LIMIT 10`,
      [LOW_STOCK]
    );
    const [[{ low_count }]] = await conn.query(
      "SELECT COUNT(*) AS low_count FROM products WHERE active = 1 AND stock <= ?",
      [LOW_STOCK]
    );

    const [[prodCounts]] = await conn.query(
      "SELECT COUNT(*) AS total, SUM(active = 1) AS active FROM products"
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
      products: { total: Number(prodCounts.total) || 0, active: Number(prodCounts.active) || 0 },
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

    if (prev !== status && (status === "cancelled" || prev === "cancelled")) {
      const [items] = await conn.query(
        "SELECT product_id, name_snapshot, qty FROM order_items WHERE order_id = ? AND product_id IS NOT NULL",
        [order.id]
      );
      for (const it of items) {
        if (status === "cancelled") {
          await conn.query("UPDATE products SET stock = stock + ? WHERE id = ?", [it.qty, it.product_id]);
          restocked += it.qty;
        } else {
          const [[p]] = await conn.query("SELECT stock FROM products WHERE id = ? FOR UPDATE", [it.product_id]);
          if (p && p.stock < it.qty) {
            throw ApiError.conflict(
              `Can't re-open this order: only ${p.stock} of "${it.name_snapshot}" left in stock.`
            );
          }
          await conn.query("UPDATE products SET stock = stock - ? WHERE id = ?", [it.qty, it.product_id]);
        }
      }
    }

    await conn.query("UPDATE orders SET status = ? WHERE id = ?", [status, order.id]);
    await conn.commit();
    return { previous: prev, status, restocked };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

/* --------------------------------------------------------------- products */

async function listProducts({ q, categoryId, state, limit, offset }) {
  const where = [];
  const params = [];
  if (q) {
    where.push("(p.name LIKE ? OR c.name LIKE ?)");
    params.push(`%${q}%`, `%${q}%`);
  }
  if (categoryId) {
    where.push("p.category_id = ?");
    params.push(categoryId);
  }
  if (state === "active") where.push("p.active = 1");
  if (state === "hidden") where.push("p.active = 0");
  if (state === "low") {
    where.push("p.stock > 0 AND p.stock <= ?");
    params.push(LOW_STOCK);
  }
  if (state === "out") where.push("p.stock <= 0");
  const w = where.length ? "WHERE " + where.join(" AND ") : "";

  const [rows] = await pool.query(
    `SELECT p.id, p.category_id, c.name AS category_name, p.name, p.emoji, p.price, p.compare_at_price,
            p.stock, p.eta_label, p.active, p.updated_at
     FROM products p JOIN categories c ON c.id = p.category_id
     ${w} ORDER BY p.updated_at DESC, p.id DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM products p JOIN categories c ON c.id = p.category_id ${w}`,
    params
  );
  return { products: rows, total: Number(total) };
}

async function getProduct(id) {
  const [rows] = await pool.query(
    `SELECT p.id, p.category_id, c.name AS category_name, p.name, p.emoji, p.price, p.compare_at_price,
            p.stock, p.eta_label, p.active, p.updated_at
     FROM products p JOIN categories c ON c.id = p.category_id WHERE p.id = ?`,
    [id]
  );
  return rows[0] || null;
}

async function assertCategory(categoryId) {
  const [rows] = await pool.query("SELECT id FROM categories WHERE id = ?", [categoryId]);
  if (!rows[0]) throw ApiError.badRequest("That category doesn't exist.");
}

async function createProduct(d) {
  await assertCategory(d.categoryId);
  const compareAt = d.compareAtPrice != null ? d.compareAtPrice : d.price;
  const [r] = await pool.query(
    `INSERT INTO products (category_id, name, emoji, price, compare_at_price, stock, eta_label, active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [d.categoryId, d.name, d.emoji || "", d.price, compareAt, d.stock ?? 0, d.etaLabel || "2–4 days", d.active === false ? 0 : 1]
  );
  return getProduct(r.insertId);
}

const PRODUCT_COLUMNS = {
  categoryId: "category_id",
  name: "name",
  emoji: "emoji",
  price: "price",
  compareAtPrice: "compare_at_price",
  stock: "stock",
  etaLabel: "eta_label",
  active: "active",
};

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
    sets.push(`${col} = ?`);
    params.push(key === "active" ? (d[key] ? 1 : 0) : d[key]);
  }
  if (sets.length) {
    await pool.query(`UPDATE products SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
  }
  return getProduct(id);
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
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
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
