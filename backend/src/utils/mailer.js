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

module.exports = { send, orderEmail, configured };
