const { pool } = require("../config/db");

const ymd = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

// Dates are Kenya time (UTC+3): shift stored UTC timestamps by 3 hours before bucketing.
const LOCAL = "DATE_ADD(o.created_at, INTERVAL 3 HOUR)";

async function range({ from, to }) {
  const t = new Date(Date.now() + 3 * 3600 * 1000);
  const today = t.toISOString().slice(0, 10);
  const f = ymd(from) || new Date(t.getTime() - 29 * 86400000).toISOString().slice(0, 10);
  const e = ymd(to) || today;
  return f <= e ? [f, e] : [e, f];
}

async function sales(q) {
  const [from, to] = await range(q);
  const w = `DATE(${LOCAL}) BETWEEN ? AND ?`;
  const [[sum]] = await pool.query(
    `SELECT COUNT(*) AS orders, COALESCE(SUM(o.total),0) AS revenue, COALESCE(SUM(o.discount),0) AS discounts,
            COALESCE(SUM(o.delivery_fee),0) AS delivery
     FROM orders o WHERE o.status <> 'cancelled' AND ${w}`, [from, to]);
  const [[cx]] = await pool.query(`SELECT COUNT(*) AS n FROM orders o WHERE o.status = 'cancelled' AND ${w}`, [from, to]);
  const [[li]] = await pool.query(
    `SELECT COALESCE(SUM(oi.qty),0) AS units,
            COALESCE(SUM(oi.line_total),0) AS goods,
            COALESCE(SUM(CASE WHEN p.cost_price IS NOT NULL THEN oi.line_total - p.cost_price * oi.qty END),0) AS profit,
            COALESCE(SUM(CASE WHEN p.cost_price IS NOT NULL THEN oi.line_total END),0) AS costed_goods
     FROM order_items oi JOIN orders o ON o.id = oi.order_id LEFT JOIN products p ON p.id = oi.product_id
     WHERE o.status <> 'cancelled' AND ${w}`, [from, to]);
  const [daily] = await pool.query(
    `SELECT DATE_FORMAT(${LOCAL}, '%Y-%m-%d') AS day, COUNT(*) AS orders, COALESCE(SUM(o.total),0) AS revenue
     FROM orders o WHERE o.status <> 'cancelled' AND ${w} GROUP BY day ORDER BY day`, [from, to]);
  const [top] = await pool.query(
    `SELECT oi.name_snapshot AS name, SUM(oi.qty) AS units, SUM(oi.line_total) AS revenue,
            SUM(CASE WHEN p.cost_price IS NOT NULL THEN oi.line_total - p.cost_price * oi.qty END) AS profit
     FROM order_items oi JOIN orders o ON o.id = oi.order_id LEFT JOIN products p ON p.id = oi.product_id
     WHERE o.status <> 'cancelled' AND ${w} GROUP BY oi.name_snapshot ORDER BY revenue DESC LIMIT 15`, [from, to]);
  const [counties] = await pool.query(
    `SELECT o.county, COUNT(*) AS orders, COALESCE(SUM(o.total),0) AS revenue
     FROM orders o WHERE o.status <> 'cancelled' AND ${w} GROUP BY o.county ORDER BY revenue DESC LIMIT 10`, [from, to]);
  const [payments] = await pool.query(
    `SELECT o.payment_method AS method, COUNT(*) AS orders, COALESCE(SUM(o.total),0) AS revenue
     FROM orders o WHERE o.status <> 'cancelled' AND ${w} GROUP BY o.payment_method`, [from, to]);
  const [[repeat]] = await pool.query(
    `SELECT COUNT(*) AS customers, COALESCE(SUM(n > 1),0) AS repeat_customers FROM
       (SELECT RIGHT(o.phone, 9) AS ph, COUNT(*) AS n FROM orders o WHERE o.status <> 'cancelled' AND ${w} GROUP BY ph) t`, [from, to]);

  const orders = Number(sum.orders);
  return {
    from, to,
    summary: {
      orders, revenue: Number(sum.revenue), avgOrder: orders ? Math.round(Number(sum.revenue) / orders) : 0,
      units: Number(li.units), cancelled: Number(cx.n), discounts: Number(sum.discounts),
      // Profit only counts items with a cost price set, so say how much of the sales that covers.
      profit: Math.round(Number(li.profit)), profitCoverage: Number(li.goods) ? Number(li.costed_goods) / Number(li.goods) : 0,
      customers: Number(repeat.customers), repeatCustomers: Number(repeat.repeat_customers),
    },
    daily: daily.map((d) => ({ ...d, orders: Number(d.orders), revenue: Number(d.revenue) })),
    top: top.map((t) => ({ ...t, units: Number(t.units), revenue: Number(t.revenue), profit: t.profit == null ? null : Math.round(Number(t.profit)) })),
    counties: counties.map((c) => ({ ...c, orders: Number(c.orders), revenue: Number(c.revenue) })),
    payments: payments.map((p) => ({ ...p, orders: Number(p.orders), revenue: Number(p.revenue) })),
  };
}

// One row per order line, for the accountant.
async function exportRows(q) {
  const [from, to] = await range(q);
  const [rows] = await pool.query(
    `SELECT o.order_code, DATE_FORMAT(${LOCAL}, '%Y-%m-%d %H:%i') AS placed, o.status, o.customer_name, o.phone, o.county,
            o.payment_method, oi.name_snapshot AS product, oi.qty, oi.unit_price_snapshot AS unit_price, oi.line_total,
            o.delivery_fee, o.discount, o.total
     FROM orders o JOIN order_items oi ON oi.order_id = o.id
     WHERE DATE(${LOCAL}) BETWEEN ? AND ? ORDER BY o.created_at, o.id, oi.id`, [from, to]);
  return { from, to, rows };
}

module.exports = { sales, exportRows };
