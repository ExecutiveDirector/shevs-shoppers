// Sends mail through Resend's HTTP API (no SDK needed). Never throws: a mail
// problem must not break checkout, so failures are logged and reported as false.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const kes = (n) => "KES " + Number(n || 0).toLocaleString("en-KE");

function configured() {
  return Boolean(process.env.RESEND_API_KEY);
}

async function send({ to, subject, html, text }) {
  if (!configured()) return { ok: false, reason: "RESEND_API_KEY is not set" };
  if (!to) return { ok: false, reason: "No owner email set" };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: process.env.MAIL_FROM || "Shevs Orders <onboarding@resend.dev>", to: [to], subject, html, text }),
      signal: AbortSignal.timeout(8000),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      console.error("Email send failed:", r.status, body.slice(0, 300));
      return { ok: false, reason: `Email provider said ${r.status}` };
    }
    return { ok: true };
  } catch (err) {
    console.error("Email send error:", err.message);
    return { ok: false, reason: "Couldn't reach the email provider" };
  }
}

function orderEmail(order, items, shopName, adminUrl) {
  const lines = items.map((i) => `${i.qty} × ${i.name_snapshot} — ${kes(i.line_total)}`);
  const text = [
    `New order ${order.order_code} — ${kes(order.total)}`,
    "",
    ...lines,
    "",
    `Customer: ${order.customer_name} (${order.phone})`,
    `Deliver to: ${order.address}, ${order.county}`,
    `Payment: ${order.payment_method === "mpesa" ? "M-Pesa" : "Cash on delivery"}`,
    "",
    "The customer will message you on WhatsApp to confirm.",
    adminUrl ? `Manage it: ${adminUrl}` : "",
  ].join("\n");
  const rows = items.map((i) => `<tr><td style="padding:4px 12px 4px 0">${esc(i.qty)} × ${esc(i.name_snapshot)}</td><td align="right">${esc(kes(i.line_total))}</td></tr>`).join("");
  const html = `<div style="font-family:system-ui,sans-serif;max-width:480px;color:#1b1b1f">
<h2 style="margin:0 0 4px">🛍️ New order ${esc(order.order_code)}</h2>
<p style="margin:0 0 14px;color:#666">${esc(shopName)} · ${esc(kes(order.total))}</p>
<table style="border-collapse:collapse;width:100%;font-size:15px">${rows}
<tr><td style="padding-top:8px;color:#666">Delivery</td><td align="right" style="padding-top:8px">${esc(kes(order.delivery_fee))}</td></tr>
${order.discount ? `<tr><td style="color:#666">Discount</td><td align="right">-${esc(kes(order.discount))}</td></tr>` : ""}
<tr><td style="padding-top:6px"><b>Total</b></td><td align="right" style="padding-top:6px"><b>${esc(kes(order.total))}</b></td></tr></table>
<p style="margin:16px 0 4px"><b>${esc(order.customer_name)}</b> · <a href="tel:${esc(order.phone)}">${esc(order.phone)}</a></p>
<p style="margin:0;color:#444">${esc(order.address)}, ${esc(order.county)}<br>${order.payment_method === "mpesa" ? "M-Pesa" : "Cash on delivery"}</p>
<p style="color:#666;font-size:13px;margin-top:16px">The customer will message you on WhatsApp to confirm.</p>
${adminUrl ? `<p><a href="${esc(adminUrl)}" style="display:inline-block;background:#1b1b1f;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Open admin</a></p>` : ""}</div>`;
  return { subject: `New order ${order.order_code} — ${kes(order.total)}`, html, text };
}

const shell = (inner) => `<div style="font-family:system-ui,sans-serif;max-width:480px;color:#1b1b1f">${inner}</div>`;
const trackUrl = (code) => (process.env.STOREFRONT_URL ? `${process.env.STOREFRONT_URL.replace(/\/$/, "")}/?track=${encodeURIComponent(code)}` : "");

// What the customer gets after ordering: their order code, what they bought, and a tracking link.
function receiptEmail(order, items, shopName) {
  const rows = items.map((i) => `<tr><td style="padding:4px 12px 4px 0">${esc(i.qty)} × ${esc(i.name_snapshot)}</td><td align="right">${esc(kes(i.line_total))}</td></tr>`).join("");
  const url = trackUrl(order.order_code);
  const text = [`Thanks for your order, ${order.customer_name}!`, `Order number: ${order.order_code}`, "", ...items.map((i) => `${i.qty} × ${i.name_snapshot} — ${kes(i.line_total)}`), "", `Delivery: ${kes(order.delivery_fee)}`, `Total: ${kes(order.total)}`, "", "We'll confirm with you on WhatsApp.", url ? `Track your order: ${url}` : ""].join("\n");
  const html = shell(`<h2 style="margin:0 0 4px">Thanks for your order!</h2><p style="color:#666;margin:0 0 14px">${esc(shopName)} · order <b>${esc(order.order_code)}</b></p>
<table style="border-collapse:collapse;width:100%;font-size:15px">${rows}<tr><td style="padding-top:8px;color:#666">Delivery</td><td align="right" style="padding-top:8px">${esc(kes(order.delivery_fee))}</td></tr>${order.discount ? `<tr><td style="color:#666">Discount</td><td align="right">-${esc(kes(order.discount))}</td></tr>` : ""}<tr><td style="padding-top:6px"><b>Total</b></td><td align="right" style="padding-top:6px"><b>${esc(kes(order.total))}</b></td></tr></table>
<p style="margin:16px 0 4px;color:#444">Deliver to: ${esc(order.address)}, ${esc(order.county)}</p><p style="color:#666;font-size:13px">We'll confirm with you on WhatsApp. Pay ${order.payment_method === "mpesa" ? "via M-Pesa" : "on delivery"}.</p>${url ? `<p><a href="${esc(url)}" style="display:inline-block;background:#1b1b1f;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Track your order</a></p>` : ""}`);
  return { subject: `Your ${shopName} order ${order.order_code}`, html, text };
}

const STATUS_COPY = {
  confirmed: ["Your order is confirmed", "We've confirmed your order and are getting it ready."],
  dispatched: ["Your order is on its way", "Your order has been dispatched. Keep your phone nearby for the rider."],
  delivered: ["Delivered — enjoy!", "Your order has been marked delivered. Thank you for shopping with us."],
  cancelled: ["Your order was cancelled", "Your order has been cancelled. Message us on WhatsApp if this is unexpected."],
};
function statusEmail(order, status, shopName) {
  const c = STATUS_COPY[status];
  if (!c) return null;
  const url = trackUrl(order.order_code);
  return { subject: `${c[0]} — ${order.order_code}`, text: `${c[1]}${url ? "\nTrack: " + url : ""}`, html: shell(`<h2 style="margin:0 0 6px">${esc(c[0])}</h2><p style="color:#666;margin:0 0 12px">${esc(shopName)} · order <b>${esc(order.order_code)}</b></p><p>${esc(c[1])}</p>${url ? `<p><a href="${esc(url)}">Track your order</a></p>` : ""}`) };
}

function restockEmail(product, shopName) {
  const base = (process.env.STOREFRONT_URL || "").replace(/\/$/, "");
  const url = base ? `${base}/p/${product.id}` : "";
  return { subject: `Back in stock: ${product.name}`, text: `Good news — ${product.name} is back in stock at ${shopName}.${url ? "\n" + url : ""}`, html: shell(`<h2 style="margin:0 0 6px">Back in stock 🎉</h2><p><b>${esc(product.name)}</b> is available again at ${esc(shopName)}. Stock is limited, so order soon.</p>${url ? `<p><a href="${esc(url)}" style="display:inline-block;background:#1b1b1f;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">View product</a></p>` : ""}`) };
}

module.exports = { send, orderEmail, receiptEmail, statusEmail, restockEmail, configured };
