const { pool } = require("../config/db");

const BASE_SELECT = `
  SELECT p.id, p.category_id, c.name AS category_name, p.name, p.emoji,
         p.price, p.compare_at_price, p.stock, p.rating, p.rating_count,
         p.eta_label, p.active
  FROM products p
  JOIN categories c ON c.id = p.category_id
`;

async function findAll({ categoryId, search, minPrice, maxPrice, minRating, onSaleOnly, sort, limit, offset }) {
  const where = ["p.active = 1"];
  const params = [];

  if (categoryId != null) {
    where.push("p.category_id = ?");
    params.push(categoryId);
  }
  if (search) {
    where.push("(p.name LIKE ? OR c.name LIKE ?)");
    params.push(`%${search}%`, `%${search}%`);
  }
  if (minPrice != null) {
    where.push("p.price >= ?");
    params.push(minPrice);
  }
  if (maxPrice != null) {
    where.push("p.price <= ?");
    params.push(maxPrice);
  }
  if (minRating != null) {
    where.push("p.rating >= ?");
    params.push(minRating);
  }
  if (onSaleOnly) {
    where.push("(p.compare_at_price - p.price) / p.compare_at_price >= 0.2");
  }

  const sortMap = {
    rel: "p.rating DESC, p.rating_count DESC",
    price_asc: "p.price ASC",
    price_desc: "p.price DESC",
    rating: "p.rating DESC, p.rating_count DESC",
    discount: "((p.compare_at_price - p.price) / p.compare_at_price) DESC",
  };
  const orderBy = sortMap[sort] || sortMap.rel;

  const sql = `${BASE_SELECT} WHERE ${where.join(" AND ")} ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
  params.push(Number(limit) || 40, Number(offset) || 0);

  const [rows] = await pool.query(sql, params);
  return rows;
}

async function findById(id) {
  const [rows] = await pool.query(`${BASE_SELECT} WHERE p.id = ? AND p.active = 1`, [id]);
  return rows[0] || null;
}

async function findRelated(categoryId, excludeId, limit = 6) {
  const [rows] = await pool.query(
    `${BASE_SELECT} WHERE p.category_id = ? AND p.id != ? AND p.active = 1 ORDER BY p.rating DESC LIMIT ?`,
    [categoryId, excludeId, limit]
  );
  return rows;
}

// Locks the row within an existing transaction (conn) so two simultaneous
// orders for the last unit of stock can't both succeed. Must be called
// with a connection that already has a transaction open.
async function lockForUpdate(conn, id) {
  const [rows] = await conn.query(
    "SELECT id, name, price, stock, active FROM products WHERE id = ? FOR UPDATE",
    [id]
  );
  return rows[0] || null;
}

async function decrementStock(conn, id, qty) {
  await conn.query("UPDATE products SET stock = stock - ? WHERE id = ?", [qty, id]);
}

module.exports = { findAll, findById, findRelated, lockForUpdate, decrementStock };
