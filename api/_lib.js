const API = (process.env.API_ORIGIN || "https://shevs-api-production.up.railway.app").replace(/\/$/, "");
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const origin = (req) => `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
async function getJson(path) {
  const r = await fetch(API + path, { signal: AbortSignal.timeout(6000) });
  if (!r.ok) return null;
  return r.json();
}
module.exports = { esc, origin, getJson };
