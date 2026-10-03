const { pool } = require("../config/db");

async function findActiveByCode(code) {
  const [rows] = await pool.query(
    `SELECT id, code, discount_amount, min_subtotal, active, expires_at
     FROM coupons
     WHERE code = ? AND active = 1 AND (expires_at IS NULL OR expires_at > NOW())`,
    [code.toUpperCase()]
  );
  return rows[0] || null;
}

module.exports = { findActiveByCode };
