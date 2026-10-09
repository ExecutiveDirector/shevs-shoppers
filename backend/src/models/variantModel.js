const { pool } = require("../config/db");
const ApiError = require("../utils/ApiError");

const MAX_PHOTOS = 12;
const MAX_VARIANTS = 30;
const VAR_COLS = "id, product_id, label, sku, cost_price, price, compare_at_price, stock, sort_order, active";

const norm = (s) => String(s || "").trim().replace(/\s+/g, " ");

// Public catalogue: attach the sizes that are switched on to each product row (prices before promotions).
async function attach(rows) {
  for (const r of rows) r.colors = splitColors(r.colors);
  if (!rows.length) return rows;
  const [vs] = await pool.query(`SELECT ${VAR_COLS} FROM product_variants WHERE active = 1 AND product_id IN (?) ORDER BY sort_order, id`, [rows.map((r) => r.id)]);
  const by = new Map();
  for (const v of vs) {
    if (!by.has(v.product_id)) by.set(v.product_id, []);
    by.get(v.product_id).push({ id: v.id, label: v.label, price: Number(v.price), compare_at_price: Number(v.compare_at_price), stock: v.stock });
  }
  for (const r of rows) { const l = by.get(r.id); if (l) r.variants = l; }
  return rows;
}

// Photos for the product page. Older products only have image_url, so fall back to that.
async function photosFor(productId, fallbackUrl) {
  const [rows] = await pool.query("SELECT url, color FROM product_photos WHERE product_id = ? ORDER BY sort_order, id", [productId]);
  if (rows.length) return rows.map((r) => ({ url: r.url, color: r.color || null }));
  return fallbackUrl ? [{ url: fallbackUrl, color: null }] : [];
}
// Colour names a customer may choose between: the product's own colour list plus any colour a photo is tagged with.
function splitColors(s) { return String(s || "").split(",").map((c) => norm(c)).filter(Boolean); }
async function colorsFor(conn, productId) {
  const db = conn || pool;
  const [[p]] = await db.query("SELECT colors FROM products WHERE id = ?", [productId]);
  const [rows] = await db.query("SELECT color FROM product_photos WHERE product_id = ? AND color IS NOT NULL AND color <> '' ORDER BY sort_order, id", [productId]);
  const seen = new Map();
  for (const c of [...splitColors(p && p.colors), ...rows.map((r) => r.color)]) if (!seen.has(c.toLowerCase())) seen.set(c.toLowerCase(), c);
  return [...seen.values()];
}

/* ---------------- admin ---------------- */
async function listAll(productId) {
  const [rows] = await pool.query(`SELECT ${VAR_COLS} FROM product_variants WHERE product_id = ? ORDER BY sort_order, id`, [productId]);
  return rows.map((v) => ({ ...v, price: Number(v.price), compare_at_price: Number(v.compare_at_price), cost_price: v.cost_price == null ? null : Number(v.cost_price), active: !!v.active }));
}
async function listPhotos(productId) {
  const [rows] = await pool.query("SELECT id, url, color FROM product_photos WHERE product_id = ? ORDER BY sort_order, id", [productId]);
  return rows;
}

// Replaces the product's photo list. The first photo is also kept as products.image_url, which the cards,
// share links and sitemap already use.
async function replacePhotos(productId, photos) {
  if (photos.length > MAX_PHOTOS) throw ApiError.badRequest(`Use at most ${MAX_PHOTOS} photos per product.`);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[p]] = await conn.query("SELECT id FROM products WHERE id = ? FOR UPDATE", [productId]);
    if (!p) { await conn.rollback(); return false; }
    await conn.query("DELETE FROM product_photos WHERE product_id = ?", [productId]);
    for (let i = 0; i < photos.length; i++) {
      await conn.query("INSERT INTO product_photos (product_id, url, color, sort_order) VALUES (?, ?, ?, ?)", [productId, photos[i].url, norm(photos[i].color).slice(0, 40) || null, i]);
    }
    // Colours named on photos become choosable colours on the product too.
    const [[cur]] = await conn.query("SELECT colors FROM products WHERE id = ?", [productId]);
    const seen = new Map();
    for (const c of [...splitColors(cur && cur.colors), ...photos.map((x) => norm(x.color)).filter(Boolean)]) if (!seen.has(c.toLowerCase())) seen.set(c.toLowerCase(), c.slice(0, 40));
    await conn.query("UPDATE products SET image_url = ?, colors = ? WHERE id = ?", [photos[0] ? photos[0].url : null, [...seen.values()].join(", ").slice(0, 255) || null, productId]);
    await conn.commit();
    return true;
  } catch (e) { await conn.rollback(); throw e; } finally { conn.release(); }
}

// Replaces the product's sizes. Rows with an id are updated (so past orders stay linked), new rows are added,
// missing ones are removed. products.price / compare_at_price / stock are kept as "from" price and total stock
// so lists, filters and low-stock alerts keep working.
async function replaceVariants(productId, list) {
  if (list.length > MAX_VARIANTS) throw ApiError.badRequest(`Use at most ${MAX_VARIANTS} sizes per product.`);
  const labels = new Set();
  for (const v of list) {
    const k = norm(v.label).toLowerCase();
    if (!k) throw ApiError.badRequest("Every size needs a name.");
    if (/[:;|]/.test(k)) throw ApiError.badRequest(`Size names can't contain : ; or | (“${norm(v.label)}”).`);
    if (labels.has(k)) throw ApiError.badRequest(`The size "${norm(v.label)}" is listed twice.`);
    labels.add(k);
  }
  const conn = await pool.getConnection();
  let wasSoldOut = false;
  try {
    await conn.beginTransaction();
    const [[p]] = await conn.query("SELECT id, stock FROM products WHERE id = ? FOR UPDATE", [productId]);
    if (!p) { await conn.rollback(); return null; }
    const [old] = await conn.query("SELECT id, label, stock FROM product_variants WHERE product_id = ? FOR UPDATE", [productId]);
    const oldById = new Map(old.map((o) => [o.id, o]));
    const keep = new Set(), logIds = [];
    // Free the unique labels first so sizes can be renamed or swapped in one save.
    for (const v of list) if (v.id && oldById.has(v.id)) await conn.query("UPDATE product_variants SET label = CONCAT('~', id) WHERE id = ?", [v.id]);
    for (let i = 0; i < list.length; i++) {
      const v = list[i], price = Number(v.price), was = v.compareAtPrice != null && v.compareAtPrice !== "" ? Number(v.compareAtPrice) : price;
      if (!(price >= 1)) throw ApiError.badRequest(`Enter a price for "${norm(v.label)}".`);
      if (was < price) throw ApiError.badRequest(`The 'was' price for "${norm(v.label)}" can't be lower than its price.`);
      const stock = Math.max(0, Math.floor(Number(v.stock) || 0));
      const active = v.active === false ? 0 : 1;
      const cost = v.costPrice != null && v.costPrice !== "" && Number(v.costPrice) >= 0 ? Number(v.costPrice) : null;
      const sku = v.sku ? String(v.sku).trim().slice(0, 40) : null;
      if (v.id && oldById.has(v.id)) {
        await conn.query("UPDATE product_variants SET label=?, sku=?, cost_price=?, price=?, compare_at_price=?, stock=?, sort_order=?, active=? WHERE id=?", [norm(v.label), sku, cost, price, was, stock, i, active, v.id]);
        keep.add(v.id);
        const diff = stock - oldById.get(v.id).stock;
        if (diff) { const [lg] = await conn.query("INSERT INTO stock_log (product_id, change_qty, stock_after, reason, note) VALUES (?, ?, 0, 'correction', ?)", [productId, diff, `Size ${norm(v.label)}`.slice(0, 200)]); logIds.push(lg.insertId); }
      } else {
        const [r] = await conn.query("INSERT INTO product_variants (product_id, label, sku, cost_price, price, compare_at_price, stock, sort_order, active) VALUES (?,?,?,?,?,?,?,?,?)", [productId, norm(v.label), sku, cost, price, was, stock, i, active]);
        keep.add(r.insertId);
        if (stock) { const [lg] = await conn.query("INSERT INTO stock_log (product_id, change_qty, stock_after, reason, note) VALUES (?, ?, 0, 'restock', ?)", [productId, stock, `Size ${norm(v.label)} · opening stock`.slice(0, 200)]); logIds.push(lg.insertId); }
      }
    }
    for (const o of old) if (!keep.has(o.id)) await conn.query("DELETE FROM product_variants WHERE id = ?", [o.id]);

    const [act] = await conn.query("SELECT price, compare_at_price, stock FROM product_variants WHERE product_id = ? AND active = 1 ORDER BY price ASC, id ASC", [productId]);
    if (act.length) {
      const total = act.reduce((s, a) => s + a.stock, 0);
      wasSoldOut = p.stock <= 0 && total > 0;
      await conn.query("UPDATE products SET price = ?, compare_at_price = ?, stock = ? WHERE id = ?", [act[0].price, Math.max(Number(act[0].compare_at_price), Number(act[0].price)), total, productId]);
      // stock_after in the log = the product total after this save
      if (logIds.length) await conn.query("UPDATE stock_log SET stock_after = ? WHERE id IN (?)", [total, logIds]);
    }
    await conn.commit();
  } catch (e) { await conn.rollback(); if (e && e.code === "ER_DUP_ENTRY") throw ApiError.badRequest("Two sizes share the same name."); throw e; } finally { conn.release(); }
  if (wasSoldOut) require("../utils/restock").notifyRestock(productId);
  return true;
}

async function setColors(productId, list) {
  const seen = new Map();
  for (const c of list.map(norm).filter(Boolean)) if (!seen.has(c.toLowerCase())) seen.set(c.toLowerCase(), c.slice(0, 40));
  const text = [...seen.values()].join(", ");
  if (text.length > 255) throw ApiError.badRequest("That's too many colours.");
  const [r] = await pool.query("UPDATE products SET colors = ? WHERE id = ?", [text || null, productId]);
  return r.affectedRows > 0;
}

// Text forms used by the CSV export, so a spreadsheet round-trips back through the import.
//   sizes:  "6x6:1500:5:900; 5x6:1400:3"   (name:price:stock[:cost])
//   photos: "https://…/a.jpg @ Pink | https://…/b.jpg @ Blue"
async function attachExportText(rows) {
  if (!rows.length) return rows;
  const ids = rows.map((r) => r.id);
  const [vs] = await pool.query("SELECT product_id, label, price, stock, cost_price FROM product_variants WHERE product_id IN (?) ORDER BY sort_order, id", [ids]);
  const [ps] = await pool.query("SELECT product_id, url, color FROM product_photos WHERE product_id IN (?) ORDER BY sort_order, id", [ids]);
  const v = new Map(), p = new Map();
  for (const x of vs) { if (!v.has(x.product_id)) v.set(x.product_id, []); v.get(x.product_id).push(`${x.label}:${Number(x.price)}:${x.stock}${x.cost_price == null ? "" : ":" + Number(x.cost_price)}`); }
  for (const x of ps) { if (!p.has(x.product_id)) p.set(x.product_id, []); p.get(x.product_id).push(x.url + (x.color ? ` @ ${x.color}` : "")); }
  for (const r of rows) { r.sizes_text = (v.get(r.id) || []).join("; "); r.photos_text = (p.get(r.id) || []).join(" | "); }
  return rows;
}

module.exports = { attachExportText, splitColors, setColors, attach, photosFor, colorsFor, listAll, listPhotos, replacePhotos, replaceVariants, MAX_PHOTOS };
