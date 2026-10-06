const { esc, origin, getJson } = require("./_lib");

module.exports = async (req, res) => {
  const home = origin(req);
  const data = await getJson("/api/products?pageSize=100").catch(() => null);
  const urls = [`<url><loc>${esc(home)}/</loc></url>`, ...((data && data.products) || []).map((p) => `<url><loc>${esc(home)}/p/${Number(p.id)}</loc></url>`)];
  res.setHeader("Content-Type", "application/xml; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=3600, stale-while-revalidate=86400");
  res.end(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join("")}</urlset>`);
};
