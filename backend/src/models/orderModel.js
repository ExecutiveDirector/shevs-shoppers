const crypto = require("crypto");
const { pool } = require("../config/db");
const productModel = require("./productModel");
const couponModel = require("./couponModel");
const settingsModel = require("./settingsModel");
const promoModel = require("./promoModel");
const ApiError = require("../utils/ApiError");

// No 0/O/1/I so codes are easy to read out over the phone or WhatsApp.
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function generateOrderCode() {
  const bytes = crypto.randomBytes(6);
  let code = "";
  for (const b of bytes) code += CODE_ALPHABET[b % CODE_ALPHABET.length];
  return `SHV-${code}`;
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Creates an order inside a single DB transaction:
 *  1. Merges repeated products and locks the rows in a fixed (id) order, so two
 *     concurrent orders can never deadlock or both oversell the last unit.
 *  2. Re-derives every price from the database — the client's cart is
 *     never trusted for money, only for which product IDs and quantities
 *     were chosen. This is the exact class of bug that cost real time on
 *     AquaGas (client-supplied unit_price), so it's closed off here from
 *     the start rather than patched in later.
 *  3. Re-validates any coupon server-side against the recomputed subtotal.
 *  4. Writes the order, its line items and the stock history, and decrements
 *     stock atomically — either all of it commits, or none of it does.
 */
async function createOrder(input) {
  const settings = await settingsModel.getAll();

  // Same product twice in a cart → one line; fixed order → no lock-order deadlocks.
  const wanted = new Map();
  for (const { productId, qty } of input.items) {
    wanted.set(productId, (wanted.get(productId) || 0) + qty);
  }
  const lines = [...wanted.entries()].sort((a, b) => a[0] - b[0]);
  for (const [, qty] of lines) {
    if (qty > 20) throw ApiError.badRequest("You can order at most 20 of one item at a time.");
  }

  const promos = await promoModel.active();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const lineItems = [];
    let subtotal = 0;

    for (const [productId, qty] of lines) {
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
      // Same promotion rules the storefront shows, re-applied here so the price is never taken from the client.
      const unitPrice = promoModel.discounted(product.price, promoModel.percentFor(promos, product, qty));
      const lineTotal = round2(unitPrice * qty);
      subtotal = round2(subtotal + lineTotal);

      lineItems.push({
        productId: product.id,
        name: product.name,
        unitPrice,
        qty,
        lineTotal,
        stockAfter: product.stock - qty,
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

    const deliveryFee = subtotal >= settings.free_delivery_threshold ? 0 : settings.delivery_fee;
    const total = Math.max(0, round2(subtotal + deliveryFee - discount));

    // Random codes can (very rarely) collide; retry with a fresh one.
    let orderCode;
    let orderId;
    for (let attempt = 0; ; attempt++) {
      orderCode = generateOrderCode();
      try {
        const [orderResult] = await conn.query(
          `INSERT INTO orders
            (order_code, customer_name, phone, customer_email, county, address, payment_method,
             status, subtotal, delivery_fee, discount, coupon_code, total)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
          [
            orderCode,
            input.customerName,
            input.phone,
            input.customerEmail || null,
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
        orderId = orderResult.insertId;
        break;
      } catch (err) {
        if (err.code === "ER_DUP_ENTRY" && attempt < 5) continue;
        throw err;
      }
    }

    for (const li of lineItems) {
      await conn.query(
        `INSERT INTO order_items (order_id, product_id, name_snapshot, unit_price_snapshot, qty, line_total)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [orderId, li.productId, li.name, li.unitPrice, li.qty, li.lineTotal]
      );
      await conn.query(
        `INSERT INTO stock_log (product_id, change_qty, stock_after, reason, order_code)
         VALUES (?, ?, ?, 'sale', ?)`,
        [li.productId, -li.qty, li.stockAfter, orderCode]
      );
    }

    await conn.commit();

    return {
      order: {
        id: orderId,
        order_code: orderCode,
        customer_name: input.customerName,
        phone: input.phone,
        customer_email: input.customerEmail || null,
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

module.exports = { createOrder, findByCode, generateOrderCode };
