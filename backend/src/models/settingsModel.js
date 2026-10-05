const { pool } = require("../config/db");

// Defaults come from the environment so the shop works before anything has
// been saved; values saved from the admin panel take priority.
function defaults() {
  return {
    shop_name: "Shevs",
    whatsapp_number: (process.env.WHATSAPP_NUMBER || "").replace(/[^0-9]/g, ""),
    delivery_fee: Number(process.env.DEFAULT_DELIVERY_FEE) || 250,
    free_delivery_threshold: Number(process.env.FREE_DELIVERY_THRESHOLD) || 3000,
    low_stock_threshold: 5,
  };
}

const NUMERIC = ["delivery_fee", "free_delivery_threshold", "low_stock_threshold"];
const TTL_MS = 15 * 1000;
let cache = null;
let cachedAt = 0;

async function getAll() {
  if (cache && Date.now() - cachedAt < TTL_MS) return cache;
  const out = defaults();
  try {
    const [rows] = await pool.query("SELECT setting_key, setting_value FROM settings");
    for (const r of rows) {
      if (!(r.setting_key in out)) continue;
      out[r.setting_key] = NUMERIC.includes(r.setting_key) ? Number(r.setting_value) : r.setting_value;
    }
  } catch (err) {
    // Settings table missing (migration not applied yet) → fall back to env defaults.
    if (err.code !== "ER_NO_SUCH_TABLE") throw err;
  }
  cache = out;
  cachedAt = Date.now();
  return out;
}

async function update(values) {
  const keys = Object.keys(defaults());
  const entries = Object.entries(values).filter(([k, v]) => keys.includes(k) && v !== undefined && v !== null);
  for (const [k, v] of entries) {
    await pool.query(
      "INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)",
      [k, String(v)]
    );
  }
  cache = null;
  return getAll();
}

module.exports = { getAll, update };
