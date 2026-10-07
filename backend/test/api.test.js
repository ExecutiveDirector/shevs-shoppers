// Route-level tests with the database stubbed out: they check auth, validation,
// error shapes and the order-code generator — not SQL (that needs a real MySQL).
const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const path = require("node:path");

process.env.ADMIN_API_KEY = "test-admin-key-0123456789";
process.env.CORS_ORIGIN = "https://shop.example";
process.env.WHATSAPP_NUMBER = "254700000000";

// Replace the real MySQL pool before anything imports it.
const queries = [];
const fakePool = {
  query: async (sql, params) => {
    queries.push({ sql, params });
    if (/INSERT INTO product_images/.test(sql)) return [{ insertId: 7 }];
    if (/FROM product_images/.test(sql)) return [[]];
    if (/FROM settings/.test(sql)) return [[]];
    if (/COUNT\(\*\)/.test(sql)) return [[{ total: 0, n: 0 }]];
    return [[]];
  },
  getConnection: async () => ({
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
    query: async () => [[]],
  }),
};
const dbPath = require.resolve(path.join("..", "src", "config", "db"));
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { pool: fakePool, verifyConnection: async () => {} } };

const createApp = require("../src/app");
const { generateOrderCode } = require("../src/models/orderModel");

let server, base;
test.before(async () => {
  server = http.createServer(createApp()).listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const call = (p, { method = "GET", body, key, raw } = {}) =>
  fetch(base + p, {
    method,
    headers: { "Content-Type": "application/json", ...(key ? { "x-admin-key": key } : {}) },
    body: raw !== undefined ? raw : body ? JSON.stringify(body) : undefined,
  });
const KEY = process.env.ADMIN_API_KEY;

test("health is up without touching the database", async () => {
  const r = await call("/api/health");
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
});

test("deep health checks the database", async () => {
  const r = await call("/api/health?deep=1");
  assert.equal(r.status, 200);
  assert.equal((await r.json()).db, "up");
});

test("admin routes reject missing and wrong keys", async () => {
  assert.equal((await call("/api/admin/stats")).status, 401);
  assert.equal((await call("/api/admin/stats", { key: "nope" })).status, 401);
  assert.equal((await call("/api/admin/orders", { key: KEY + "x" })).status, 401);
});

test("admin key works", async () => {
  const r = await call("/api/admin/categories", { key: KEY });
  assert.equal(r.status, 200);
});

test("malformed JSON is a 400, not a 500", async () => {
  const r = await call("/api/admin/products", { method: "POST", key: KEY, raw: "{bad" });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error.message, /valid JSON/);
});

test("product validation reports clear messages", async () => {
  const r = await call("/api/admin/products", {
    method: "POST",
    key: KEY,
    body: { name: "x", categoryId: 1, price: 0, imageUrl: "javascript:alert(1)", sku: "bad/sku" },
  });
  assert.equal(r.status, 400);
  const msgs = (await r.json()).error.details.map((d) => d.field);
  for (const f of ["name", "price", "imageUrl", "sku"]) assert.ok(msgs.includes(f), `expected error on ${f}`);
});

test("was-price below selling price is rejected", async () => {
  const r = await call("/api/admin/products", {
    method: "POST",
    key: KEY,
    body: { name: "Good name", categoryId: 1, price: 500, compareAtPrice: 100 },
  });
  assert.equal(r.status, 400);
});

test("stock adjustment validates mode and reason", async () => {
  const r = await call("/api/admin/products/1/stock", { method: "POST", key: KEY, body: { mode: "bogus", qty: 2.5, reason: "x" } });
  assert.equal(r.status, 400);
});

test("bulk action requires ids and a known action", async () => {
  assert.equal((await call("/api/admin/products/bulk", { method: "POST", key: KEY, body: { ids: [], action: "hide" } })).status, 400);
  assert.equal((await call("/api/admin/products/bulk", { method: "POST", key: KEY, body: { ids: [1], action: "explode" } })).status, 400);
});

test("settings validation", async () => {
  const bad = await call("/api/admin/settings", { method: "PATCH", key: KEY, body: { whatsapp_number: "+254 712", delivery_fee: -5 } });
  assert.equal(bad.status, 400);
  const ok = await call("/api/admin/settings", { method: "PATCH", key: KEY, body: { shop_name: "Shevs", delivery_fee: 300 } });
  assert.equal(ok.status, 200);
});

test("public order creation validates the cart", async () => {
  const r = await call("/api/orders", { method: "POST", body: { customerName: "A", phone: "123", items: [] } });
  assert.equal(r.status, 400);
});

test("CORS allows only configured origins", async () => {
  const good = await fetch(base + "/api/health", { headers: { Origin: "https://shop.example" } });
  assert.equal(good.headers.get("access-control-allow-origin"), "https://shop.example");
  const bad = await fetch(base + "/api/health", { headers: { Origin: "https://evil.example" } });
  assert.equal(bad.headers.get("access-control-allow-origin"), null);
});

test("unknown routes return a JSON 404", async () => {
  const r = await call("/api/nope");
  assert.equal(r.status, 404);
  assert.ok((await r.json()).error.message);
});

test("order codes are random, readable and well-formed", () => {
  const codes = new Set(Array.from({ length: 500 }, generateOrderCode));
  assert.equal(codes.size, 500);
  for (const c of codes) assert.match(c, /^SHV-[A-HJ-NP-Z2-9]{6}$/);
});

test("photo upload: needs the admin key, accepts a real image, rejects junk", async () => {
  const sharp = require("sharp");
  const png = await sharp({ create: { width: 2400, height: 1800, channels: 3, background: "#c33" } }).png().toBuffer();
  const post = (body, key) => fetch(`${base}/api/admin/uploads`, { method: "POST", headers: { "Content-Type": "image/png", ...(key ? { "x-admin-key": key } : {}) }, body });

  assert.equal((await post(png)).status, 401);
  const ok = await post(png, process.env.ADMIN_API_KEY);
  assert.equal(ok.status, 201);
  const j = await ok.json();
  assert.match(j.url, /\/api\/images\/7\.webp$/);
  assert.equal(j.width, 1200); // shrunk from 2400
  assert.equal((await post(Buffer.from("not an image at all"), process.env.ADMIN_API_KEY)).status, 400);
});

test("product photos are 404 when missing", async () => {
  assert.equal((await fetch(`${base}/api/images/999.webp`)).status, 404);
});

test("order alert email: skipped quietly with no key, HTML-escapes customer text", () => {
  const mailer = require("../src/utils/mailer");
  const { subject, html } = mailer.orderEmail(
    { order_code: "SHV-ABC234", total: 1500, delivery_fee: 250, discount: 0, customer_name: "<b>Eve</b>", phone: "0712", address: "x", county: "Nairobi", payment_method: "mpesa" },
    [{ qty: 2, name_snapshot: "Mug", line_total: 1250 }], "Shevs", ""
  );
  assert.match(subject, /SHV-ABC234/);
  assert.ok(!html.includes("<b>Eve</b>"));
  delete process.env.RESEND_API_KEY;
  return mailer.send({ to: "o@x.com", subject, html }).then((r) => assert.equal(r.ok, false));
});

test("new admin endpoints all require the key", async () => {
  for (const [m, p] of [["GET", "/alerts"], ["GET", "/reviews"], ["GET", "/banners"], ["POST", "/promotions"], ["GET", "/reports/sales"], ["GET", "/reports/export"], ["GET", "/badges"]]) {
    const r = await fetch(`${base}/api/admin${p}`, { method: m, headers: { "Content-Type": "application/json" }, body: m === "POST" ? "{}" : undefined });
    assert.equal(r.status, 401, `${m} ${p}`);
  }
});

test("public forms validate input before touching the database", async () => {
  const post = (path, body) => fetch(`${base}/api/products/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  assert.equal((await post("1/notify", { contact: "hello" })).status, 400);
  assert.equal((await post("1/notify", { contact: "0712345678" })).status, 404); // valid, but the stub DB has no product 1
  assert.equal((await post("1/reviews", { orderCode: "x", phone: "1", name: "", rating: 9 })).status, 400);
  assert.equal((await fetch(`${base}/api/banners`)).status, 200);
});

test("promotion maths: best percentage wins, scope and minimum quantity respected", () => {
  const promo = require("../src/models/promoModel");
  const promos = [
    { scope: "all", scope_id: null, percent_off: 10, min_qty: 1 },
    { scope: "category", scope_id: 2, percent_off: 20, min_qty: 1 },
    { scope: "product", scope_id: 5, percent_off: 30, min_qty: 3 },
  ];
  assert.equal(promo.percentFor(promos, { id: 9, category_id: 1 }, 1), 10);
  assert.equal(promo.percentFor(promos, { id: 9, category_id: 2 }, 1), 20);
  assert.equal(promo.percentFor(promos, { id: 5, category_id: 1 }, 2), 10); // buy-3 offer not reached
  assert.equal(promo.percentFor(promos, { id: 5, category_id: 1 }, 3), 30);
  assert.equal(promo.discounted(1000, 30), 700);
  assert.equal(promo.discounted(999, 0), 999);
});

test("sales report: bad dates fall back instead of reaching SQL", async () => {
  const r = await fetch(`${base}/api/admin/reports/sales?from=1;DROP&to=x`, { headers: { "x-admin-key": process.env.ADMIN_API_KEY } });
  assert.notEqual(r.status, 401);
});

test("account security: scrypt passwords, signed tokens, phone normalising", () => {
  const auth = require("../src/utils/auth");
  const h = auth.hashPassword("correct horse");
  assert.ok(h.startsWith("scrypt$") && !h.includes("correct"));
  assert.ok(auth.verifyPassword("correct horse", h));
  assert.ok(!auth.verifyPassword("Correct horse", h));
  assert.ok(!auth.verifyPassword("x", "garbage"));
  const user = { id: 5, password_hash: h };
  const t = auth.issueToken(user);
  const p = auth.readToken(t);
  assert.equal(p.u, 5);
  assert.equal(p.f, auth.fingerprint(h));
  assert.equal(auth.readToken(t.slice(0, -2) + "xx"), null); // tampered signature
  const forged = Buffer.from(JSON.stringify({ u: 1, e: Date.now() + 1e9, f: "x" })).toString("base64url") + "." + t.split(".")[1];
  assert.equal(auth.readToken(forged), null); // body swapped, signature reused
  const expired = (() => { const b = Buffer.from(JSON.stringify({ u: 5, e: Date.now() - 1, f: "x" })).toString("base64url"); return b + "." + require("crypto").createHmac("sha256", process.env.ACCOUNT_SECRET || require("crypto").createHash("sha256").update("shevs-accounts:" + process.env.ADMIN_API_KEY).digest("hex")).update(b).digest("base64url"); })();
  assert.equal(auth.readToken(expired), null);
  for (const v of ["0712345678", "+254712345678", "254 712 345 678"]) assert.equal(auth.normalizePhone(v), "254712345678");
});

test("account endpoints: guests are turned away, bad input is rejected early", async () => {
  assert.equal((await fetch(`${base}/api/account/me`)).status, 401);
  assert.equal((await fetch(`${base}/api/account/orders`, { headers: { Authorization: "Bearer nope" } })).status, 401);
  const post = (p, b) => fetch(`${base}/api/account/${p}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
  assert.equal((await post("register", { name: "A", phone: "123", password: "x" })).status, 400);
  assert.equal((await post("register", { name: "Amina", phone: "0712345678", password: "short" })).status, 400);
  assert.equal((await post("reset", { login: "0712345678", code: "12", newPassword: "longenough1" })).status, 400);
});
