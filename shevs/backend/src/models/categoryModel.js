const { pool } = require("../config/db");

async function findAll() {
  const [rows] = await pool.query(
    `SELECT c.id, c.name, c.icon,
            (SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.active = 1) AS product_count
     FROM categories c
     ORDER BY c.sort_order ASC`
  );
  return rows;
}

module.exports = { findAll };
