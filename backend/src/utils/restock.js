const { pool } = require("../config/db");
const engagement = require("../models/engagementModel");
const settingsModel = require("../models/settingsModel");
const mailer = require("./mailer");

// Called after a product goes from sold out to in stock. Email signups are told
// automatically; phone signups stay "waiting" in the admin so the owner can
// message them on WhatsApp. Never throws — restocking must not fail because of mail.
async function notifyRestock(productId) {
  try {
    const pending = await engagement.pendingForProduct(productId);
    if (!pending.length) return;
    const [[product]] = await pool.query("SELECT id, name FROM products WHERE id = ?", [productId]);
    const s = await settingsModel.getAll();
    const done = [];
    for (const a of pending) {
      if (a.kind !== "email") continue;
      const r = await mailer.send({ to: a.contact, ...mailer.restockEmail(product, s.shop_name) });
      if (r.ok) done.push(a.id);
    }
    await engagement.markAlerts(done);
  } catch (err) {
    console.error("Restock notification failed:", err.message);
  }
}

module.exports = { notifyRestock };
