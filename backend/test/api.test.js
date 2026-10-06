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
