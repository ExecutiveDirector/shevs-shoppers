const { pool } = require("../config/db");
const productModel = require("./productModel");
const couponModel = require("./couponModel");
const ApiError = require("../utils/ApiError");

const FREE_DELIVERY_THRESHOLD = Number(process.env.FREE_DELIVERY_THRESHOLD) || 3000;
const DEFAULT_DELIVERY_FEE = Number(process.env.DEFAULT_DELIVERY_FEE) || 250;

function generateOrderCode() {
  const stamp = Date.now().toString().slice(-6);
  return `SHV-${stamp}`;
}

/**
 * Creates an order inside a single DB transaction:
 *  1. Locks every product row involved (SELECT ... FOR UPDATE) so two
 *     concurrent orders can't both oversell the last unit of stock.
 *  2. Re-derives every price from the database — the client's cart is
 *     never trusted for money, only for which product IDs and quantities
 *     were chosen. This is the exact class of bug that cost real time on
 *     AquaGas (client-supplied unit_price), so it's closed off here from
 *     the start rather than patched in later.
 *  3. Re-validates any coupon server-side against the recomputed subtotal.
 *  4. Writes the order, its line items, and decrements stock atomically —
 *     either all of it commits, or none of it does.
 */
async function createOrder(input) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const lineItems = [];
    let subtotal = 0;

    for (const { productId, qty } of input.items) {
      const product = await productModel.lockForUpdate(conn, productId);
      if (!product || !product.active) {
        throw ApiError.badRequest(`One of the items in your cart is no longer available.`, {
          productId,
        });
      }
      if (product.stock < qty) {
        throw ApiError.conflict(
          product.stock > 0
            ? `Only ${product.stock} left of "${product.name}" — please adjust the quantity.`
            : `"${product.name}" just sold out.`
        );
      }
      const unitPrice = Number(product.price);
      const lineTotal = unitPrice * qty;
      subtotal += lineTotal;

      lineItems.push({
        productId: product.id,
        name: product.name,
        unitPrice,
        qty,
        lineTotal,
      });

      await productModel.decrementStock(conn, product.id, qty);
    }

    let discount = 0;
    let couponCode = null;
    if (input.couponCode) {
      const coupon = await couponModel.findActiveByCode(input.couponCode);
      if (coupon && subtotal >= Number(coupon.min_subtotal)) {
        discount = Number(coupon.discount_amount);
        couponCode = coupon.code;
      }
      // An invalid/expired/under-minimum code is silently ignored rather
      // than failing the whole order — the front end already told the
      // customer whether it applied before they reached this point.
    }

    const deliveryFee = subtotal >= FREE_DELIVERY_THRESHOLD ? 0 : DEFAULT_DELIVERY_FEE;
    const total = Math.max(0, subtotal + deliveryFee - discount);
    const orderCode = generateOrderCode();

    const [orderResult] = await conn.query(
      `INSERT INTO orders
        (order_code, customer_name, phone, county, address, payment_method,
         status, subtotal, delivery_fee, discount, coupon_code, total)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
      [
        orderCode,
        input.customerName,
        input.phone,
        input.county,
        input.address,
        input.paymentMethod,
        subtotal,
        deliveryFee,
        discount,
        couponCode,
        total,
      ]
    );
    const orderId = orderResult.insertId;

    for (const li of lineItems) {
      await conn.query(
        `INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price_snapshot, qty, line_total)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [orderId, li.productId, li.name, li.unitPrice, li.qty, li.lineTotal]
      );
    }

    await conn.commit();

    return {
      order: {
        id: orderId,
        order_code: orderCode,
        customer_name: input.customerName,
        phone: input.phone,
        county: input.county,
        address: input.address,
        payment_method: input.paymentMethod,
        status: "pending",
        subtotal,
        delivery_fee: deliveryFee,
        discount,
        coupon_code: couponCode,
        total,
      },
      items: lineItems.map((li) => ({
        name_snapshot: li.name,
        unit_price_snapshot: li.unitPrice,
        qty: li.qty,
        line_total: li.lineTotal,
      })),
    };
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}

async function findByCode(orderCode) {
  const [orders] = await pool.query("SELECT * FROM orders WHERE order_code = ?", [orderCode]);
  const order = orders[0];
  if (!order) return null;

  const [items] = await pool.query(
    "SELECT name_snapshot, unit_price_snapshot, qty, line_total FROM order_items WHERE order_id = ?",
    [order.id]
  );
  return { order, items };
}

async function listForAdmin({ status, limit, offset }) {
  const where = [];
  const params = [];
  if (status) {
    where.push("status = ?");
    params.push(status);
  }
  const sql = `
    SELECT id, order_code, customer_name, phone, county, status, total, created_at
    FROM orders
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?`;
  params.push(Number(limit) || 50, Number(offset) || 0);

  const [rows] = await pool.query(sql, params);
  return rows;
}

async function updateStatus(orderCode, status) {
  const [result] = await pool.query("UPDATE orders SET status = ? WHERE order_code = ?", [
    status,
    orderCode,
  ]);
  return result.affectedRows > 0;
}

module.exports = { createOrder, findByCode, listForAdmin, updateStatus };
