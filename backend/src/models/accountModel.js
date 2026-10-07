const crypto = require("crypto");
const { pool } = require("../config/db");
const ApiError = require("../utils/ApiError");
const auth = require("../utils/auth");

const PUBLIC = "id, name, phone, email, county, address, created_at";
const publicUser = (u) => u && { id: u.id, name: u.name, phone: u.phone, email: u.email, county: u.county, address: u.address, createdAt: u.created_at, hasPassword: !!u.password_hash, google: !!u.google_id };

async function findById(id) {
  const [rows] = await pool.query("SELECT * FROM users WHERE id = ?", [id]);
  return rows[0] || null;
}
// "login" is a phone number or an email address.
async function findByLogin(login) {
  const v = String(login || "").trim();
  const [rows] = v.includes("@")
    ? await pool.query("SELECT * FROM users WHERE email = ?", [v.toLowerCase()])
    : await pool.query("SELECT * FROM users WHERE phone = ?", [auth.normalizePhone(v)]);
  return rows[0] || null;
}

async function register({ name, phone, email, password }) {
  const hash = auth.hashPassword(password);
  try {
    const [r] = await pool.query("INSERT INTO users (name, phone, email, password_hash) VALUES (?, ?, ?, ?)", [name, auth.normalizePhone(phone), email ? email.toLowerCase() : null, hash]);
    return findById(r.insertId);
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      throw ApiError.conflict(/email/.test(err.message) ? "That email is already registered. Try signing in." : "That phone number already has an account. Try signing in.");
    }
    throw err;
  }
}

// Sign in or register with a verified Google profile.
//  1. Known Google id            -> sign in.
//  2. Same (Google-verified) email as an existing account -> link Google to it, so nobody ends up with two accounts.
//  3. Otherwise                  -> create an account (phone can be added later, at checkout or in details).
async function googleLogin({ sub, email, name }) {
  let [rows] = await pool.query("SELECT * FROM users WHERE google_id = ?", [sub]);
  let user = rows[0];
  if (!user) {
    [rows] = await pool.query("SELECT * FROM users WHERE email = ?", [email]);
    user = rows[0];
    if (user) {
      if (user.google_id) throw ApiError.conflict("That email is linked to a different Google account.");
      await pool.query("UPDATE users SET google_id = ? WHERE id = ?", [sub, user.id]);
    } else {
      try {
        const [r] = await pool.query("INSERT INTO users (name, email, google_id) VALUES (?, ?, ?)", [name, email, sub]);
        user = { id: r.insertId };
      } catch (err) {
        if (err.code === "ER_DUP_ENTRY") throw ApiError.conflict("Please try signing in again.");
        throw err;
      }
    }
  }
  await pool.query("UPDATE users SET last_login_at = UTC_TIMESTAMP() WHERE id = ?", [user.id]);
  return findById(user.id);
}

async function login(loginValue, password) {
  const user = await findByLogin(loginValue);
  if (!user) { auth.burn(password); return null; }
  if (!auth.verifyPassword(password, user.password_hash)) return null;
  await pool.query("UPDATE users SET last_login_at = UTC_TIMESTAMP() WHERE id = ?", [user.id]);
  return user;
}

async function updateProfile(user, d) {
  const sets = [], params = [];
  if (d.name !== undefined) { sets.push("name = ?"); params.push(d.name); }
  if (d.email !== undefined) { sets.push("email = ?"); params.push(d.email ? d.email.toLowerCase() : null); }
  if (d.county !== undefined) { sets.push("county = ?"); params.push(d.county || null); }
  if (d.address !== undefined) { sets.push("address = ?"); params.push(d.address || null); }
  if (d.phone && !user.phone) { sets.push("phone = ?"); params.push(auth.normalizePhone(d.phone)); }
  if (d.newPassword) {
    if (user.password_hash && !auth.verifyPassword(d.currentPassword || "", user.password_hash)) throw ApiError.badRequest("Your current password isn't right.");
    sets.push("password_hash = ?"); params.push(auth.hashPassword(d.newPassword));
  }
  if (sets.length) {
    try { await pool.query(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, [...params, user.id]); }
    catch (err) { if (err.code === "ER_DUP_ENTRY") throw ApiError.conflict(/phone/.test(err.message) ? "That phone number already has an account." : "That email is already used by another account."); throw err; }
  }
  return findById(user.id);
}

/* ---- orders ---- */
async function listOrders(userId) {
  const [orders] = await pool.query(
    `SELECT id, order_code, status, subtotal, delivery_fee, discount, total, payment_method, county, address, created_at
     FROM orders WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 100`, [userId]);
  if (!orders.length) return [];
  const [items] = await pool.query(
    `SELECT oi.order_id, oi.product_id, oi.name_snapshot, oi.unit_price_snapshot, oi.qty, oi.line_total, p.image_url, p.emoji
     FROM order_items oi LEFT JOIN products p ON p.id = oi.product_id WHERE oi.order_id IN (?) ORDER BY oi.id`, [orders.map((o) => o.id)]);
  const by = new Map();
  for (const it of items) { if (!by.has(it.order_id)) by.set(it.order_id, []); by.get(it.order_id).push(it); }
  return orders.map((o) => ({ ...o, items: by.get(o.id) || [] }));
}

// Attach an older (guest) order to this account. The random order code plus the phone used on it
// is the proof, the same check the order tracker and reviews use.
async function claimOrder(userId, orderCode, phone) {
  const [rows] = await pool.query("SELECT id, phone, user_id FROM orders WHERE order_code = ?", [String(orderCode).toUpperCase()]);
  const o = rows[0];
  if (!o || auth.normalizePhone(o.phone) !== auth.normalizePhone(phone)) throw ApiError.badRequest("We couldn't match that order number and phone number.");
  if (o.user_id && o.user_id !== userId) throw ApiError.conflict("That order already belongs to another account.");
  await pool.query("UPDATE orders SET user_id = ? WHERE id = ?", [userId, o.id]);
}

/* ---- forgotten password: a 6-digit code emailed to the address on the account ---- */
async function startReset(user) {
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
  await pool.query("UPDATE users SET reset_hash = ?, reset_expires = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 15 MINUTE), reset_tries = 0 WHERE id = ?", [crypto.createHash("sha256").update(code).digest("hex"), user.id]);
  return code;
}
async function finishReset(user, code, newPassword) {
  const [[u]] = await pool.query("SELECT reset_hash, reset_tries, (reset_expires > UTC_TIMESTAMP()) AS live FROM users WHERE id = ?", [user.id]);
  const bad = ApiError.badRequest("That code isn't right or has expired. Request a new one.");
  if (!u.reset_hash || !u.live || u.reset_tries >= 5) throw bad;
  const got = crypto.createHash("sha256").update(String(code)).digest("hex");
  if (got !== u.reset_hash) { await pool.query("UPDATE users SET reset_tries = reset_tries + 1 WHERE id = ?", [user.id]); throw bad; }
  await pool.query("UPDATE users SET password_hash = ?, reset_hash = NULL, reset_expires = NULL, reset_tries = 0 WHERE id = ?", [auth.hashPassword(newPassword), user.id]);
}

/* ---- admin ---- */
async function adminSetTempPassword(userId) {
  const temp = crypto.randomBytes(5).toString("hex"); // 10 characters
  const [r] = await pool.query("UPDATE users SET password_hash = ?, reset_hash = NULL WHERE id = ?", [auth.hashPassword(temp), userId]);
  return r.affectedRows ? temp : null;
}

module.exports = { googleLogin, publicUser, findById, findByLogin, register, login, updateProfile, listOrders, claimOrder, startReset, finishReset, adminSetTempPassword };
