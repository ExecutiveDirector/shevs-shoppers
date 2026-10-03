/**
 * Builds a wa.me deep link pre-filled with the order summary, so the
 * customer's next tap after checkout opens WhatsApp with everything
 * the shop owner needs to confirm and arrange payment.
 */
function buildOrderWhatsAppLink(order, items) {
  const number = (process.env.WHATSAPP_NUMBER || "").replace(/[^0-9]/g, "");
  const lines = [
    `Hi Shevs, I'd like to confirm order ${order.order_code}.`,
    "",
    ...items.map((it) => `${it.qty} x ${it.name_snapshot} — KES ${Number(it.line_total).toLocaleString("en-KE")}`),
    "",
    `Delivery: KES ${Number(order.delivery_fee).toLocaleString("en-KE")}`,
    order.discount ? `Discount: -KES ${Number(order.discount).toLocaleString("en-KE")}` : null,
    `Total: KES ${Number(order.total).toLocaleString("en-KE")}`,
    "",
    `Name: ${order.customer_name}`,
    `Phone: ${order.phone}`,
    `Deliver to: ${order.address}, ${order.county}`,
    `Payment method: ${order.payment_method === "mpesa" ? "M-Pesa" : "Cash on delivery"}`,
  ].filter(Boolean);

  const text = encodeURIComponent(lines.join("\n"));
  return `https://wa.me/${number}?text=${text}`;
}

module.exports = { buildOrderWhatsAppLink };
