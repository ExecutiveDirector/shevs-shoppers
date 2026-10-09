const crypto = require("crypto");
const { pool } = require("../config/db");
const productModel = require("./productModel");
const couponModel = require("./couponModel");
const settingsModel = require("./settingsModel");
const promoModel = require("./promoModel");
const variantModel = require("./variantModel");
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

  // Same product + size + colour twice in a cart → one line; fixed order → no lock-order deadlocks.
  const wanted = new Map();
  for (const { productId, qty, variantId, color } of input.items) {
    const c = color ? String(color).trim().slice(0, 40) : "";
    const key = `${productId}|${variantId || 0}|${c.toLowerCase()}`;
    const cur = wanted.get(key) || { productId, variantId: variantId || 0, color: c, qty: 0 };
    cur.qty += qty;
    wanted.set(key, cur);
  }
  const lines = [...wanted.values()].sort((a, b) => a.productId - b.productId || a.variantId - b.variantId);
  for (const l of lines) {
    if (l.qty > 20) throw ApiError.badRequest("You can order at most 20 of one item at a time.");
  }

  const promos = await promoModel.active();
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const lineItems = [];
    let subtotal = 0;

    for (const { productId, variantId, color, qty } of lines) {
      const product = await productModel.lockForUpdate(conn, productId);
      if (!product || !product.active) {
        throw ApiError.badRequest(`One of the items in your cart is no longer available.`, {
          productId,
        });
      }
      // Sizes: when a product has them, the size decides the price and the stock.
      const [sizes] = await conn.query(
        "SELECT id, label, price, stock FROM product_variants WHERE product_id = ? AND active = 1 ORDER BY id FOR UPDATE", [productId]);
      let variant = null;
      if (sizes.length) {
        if (!variantId) throw ApiError.badRequest(`Please choose a size for "${product.name}".`);
        variant = sizes.find((v) => v.id === variantId);
        if (!variant) throw ApiError.badRequest(`That size of "${product.name}" is no longer available. Please choose another.`);
      } else if (variantId) {
        throw ApiError.badRequest(`"${product.name}" is no longer sold in sizes. Please refresh your cart.`);
      }
      const colors = await variantModel.colorsFor(conn, productId);
      let chosenColor = null;
      if (colors.length >= 2) {
        chosenColor = colors.find((c) => c.toLowerCase() === String(color || "").toLowerCase());
        if (!chosenColor) throw ApiError.badRequest(`Please choose a colour for "${product.name}".`);
      }
      const shownName = `${product.name}${variant || chosenColor ? ` (${[variant && variant.label, chosenColor].filter(Boolean).join(", ")})` : ""}`;
      const available = variant ? variant.stock : product.stock;
      if (available < qty) {
        throw ApiError.conflict(
          available > 0
            ? `Only ${available} left of "${shownName}" — please adjust the quantity.`
            : `"${shownName}" just sold out.`
        );
      }
      // Same promotion rules the storefront shows, re-applied here so the price is never taken from the client.
      const basePrice = variant ? variant.price : product.price;
      const unitPrice = promoModel.discounted(basePrice, promoModel.percentFor(promos, product, qty));
      const lineTotal = round2(unitPrice * qty);
      subtotal = round2(subtotal + lineTotal);

      lineItems.push({
        productId: product.id,
        variantId: variant ? variant.id : null,
        color: chosenColor,
        name: shownName,
        unitPrice,
        qty,
        lineTotal,
        stockAfter: product.stock - qty,
      });

      if (variant) await conn.query("UPDATE product_variants SET stock = stock - ? WHERE id = ?", [qty, variant.id]);
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
            (order_code, user_id, customer_name, phone, customer_email, county, address, payment_method,
             status, subtotal, delivery_fee, discount, coupon_code, total)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)`,
          [
            orderCode,
            input.userId || null,
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
        `INSERT INTO order_items (order_id, product_id, variant_id, color, name_snapshot, unit_price_snapshot, qty, line_total)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [orderId, li.productId, li.variantId, li.color, li.name, li.unitPrice, li.qty, li.lineTotal]
      );
      await conn.query(
        `INSERT INTO stock_log (product_id, change_qty, stock_after, reason, order_code, note)
         VALUES (?, ?, ?, 'sale', ?, ?)`,
        [li.productId, -li.qty, li.stockAfter, orderCode, li.variantId ? li.name.slice(0, 200) : null]
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
