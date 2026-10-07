const crypto = require("crypto");

/* ---- passwords: scrypt with a random salt (built into Node, no extra package) ---- */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}
function verifyPassword(password, stored) {
  const [kind, saltHex, hashHex] = String(stored || "").split("$");
  if (kind !== "scrypt" || !saltHex || !hashHex) return false;
  const want = Buffer.from(hashHex, "hex");
  const got = crypto.scryptSync(password, Buffer.from(saltHex, "hex"), want.length);
  return want.length === got.length && crypto.timingSafeEqual(want, got);
}
// Burn the same time when the account doesn't exist, so response time doesn't reveal which logins exist.
const DUMMY = hashPassword("not-a-real-password");
const burn = (password) => verifyPassword(password, DUMMY);

/* ---- sign-in tokens: user id + expiry + a fingerprint of the password, HMAC-signed ---- */
const DAYS = 30;
const secret = () => process.env.ACCOUNT_SECRET || crypto.createHash("sha256").update("shevs-accounts:" + (process.env.ADMIN_API_KEY || "dev")).digest("hex");
const b64 = (s) => Buffer.from(s).toString("base64url");
const sign = (body) => crypto.createHmac("sha256", secret()).update(body).digest("base64url");
// Changing the password changes the fingerprint, which signs out every other device.
const fingerprint = (hash) => crypto.createHash("sha256").update(String(hash)).digest("hex").slice(0, 12);

function issueToken(user) {
  const body = b64(JSON.stringify({ u: user.id, e: Date.now() + DAYS * 864e5, f: fingerprint(user.password_hash) }));
  return `${body}.${sign(body)}`;
}
function readToken(token) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  const expect = sign(body);
  const a = Buffer.from(sig), b = Buffer.from(expect);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    return p.e > Date.now() ? p : null;
  } catch { return null; }
}

/* ---- phones: store one canonical form so 0712…, +254712… and 254712… are the same person ---- */
const digits = (s) => String(s || "").replace(/\D/g, "");
const normalizePhone = (s) => "254" + digits(s).slice(-9);

module.exports = { hashPassword, verifyPassword, burn, issueToken, readToken, fingerprint, normalizePhone, digits };
