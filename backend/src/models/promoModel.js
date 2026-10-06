const { pool } = require("../config/db");

const TTL = 30 * 1000;
let cache = null, at = 0;

// Promotions that are switched on and inside their date window right now.
async function active() {
  if (cache && Date.now() - at < TTL) return cache;
  const [rows] = await pool.query(
    `SELECT id, name, percent_off, scope, scope_id, min_qty FROM promotions
     WHERE active = 1 AND (starts_at IS NULL OR starts_at <= UTC_TIMESTAMP()) AND (ends_at IS NULL OR ends_at > UTC_TIMESTAMP())`
  );
  cache = rows;
  at = Date.now();
  return rows;
}
const clearCache = () => { cache = null; };

const matches = (pr, p) =>
  pr.scope === "all" ||
  (pr.scope === "category" && Number(pr.scope_id) === Number(p.category_id)) ||
  (pr.scope === "product" && Number(pr.scope_id) === Number(p.id));

// Best percentage off for this product when buying `qty` (0 if none).
function percentFor(promos, p, qty) {
  let best = 0;
  for (const pr of promos) if (matches(pr, p) && qty >= pr.min_qty && pr.percent_off > best) best = pr.percent_off;
  return best;
}

// Promotional prices are whole shillings, so nothing shows as KES 17,099.1.
const discounted = (price, pct) => (pct ? Math.round((Number(price) * (100 - pct)) / 100) : Number(price));

/**
 * Applies live promotions to catalogue rows. Single-item sales (min_qty 1)
 * lower the price and keep the old one as the crossed-out "was" price; buy-N
 * offers are attached as `bulk` so carts can show and apply them.
 */
async function decorate(rows) {
  const promos = await active();
  if (!promos.length) return rows;
  for (const p of rows) {
    const base = Number(p.price);
    const pct = percentFor(promos, p, 1);
    if (pct) {
      p.compare_at_price = Math.max(Number(p.compare_at_price) || 0, base);
      p.price = discounted(base, pct);
    }
    const tiers = promos.filter((pr) => pr.min_qty > 1 && matches(pr, p)).map((pr) => ({ minQty: pr.min_qty, percent: pr.percent_off }));
    // Every tier is sent with the undiscounted price so the cart can work out the same total the server will.
    if (tiers.length) { p.bulk = tiers; p.base_price = base; }
  }
  return rows;
}

module.exports = { active, clearCache, percentFor, discounted, decorate };
