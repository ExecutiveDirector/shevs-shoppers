// /p/<id> → a tiny page carrying the product's share preview (WhatsApp, Facebook,
// X and Google read these tags without running JavaScript), then sends people
// on to the real storefront at /#p<id>.
const { esc, origin, getJson } = require("./_lib");

module.exports = async (req, res) => {
  const id = parseInt(req.query.id, 10);
  const home = origin(req);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=600");
  const data = id > 0 ? await getJson(`/api/products/${id}`).catch(() => null) : null;
  const p = data && data.product;
  if (!p || p.active === 0 || p.active === false) {
    res.statusCode = 302;
    res.setHeader("Location", "/");
    return res.end();
  }
  const settings = (await getJson("/api/settings").catch(() => null)) || {};
  const shop = settings.shopName || "Shevs";
  const price = "KES " + Number(p.price).toLocaleString("en-KE");
  const title = `${p.name} — ${price} | ${shop}`;
  const desc = (p.description || `${p.name}${p.brand ? " by " + p.brand : ""}. Order online and confirm on WhatsApp. Delivered across Kenya.`).replace(/\s+/g, " ").slice(0, 200);
  const url = `${home}/p/${id}`;
  const img = p.image_url && /^https?:\/\//.test(p.image_url) ? p.image_url : "";
  res.end(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${esc(url)}">
<meta property="og:type" content="product"><meta property="og:site_name" content="${esc(shop)}">
<meta property="og:title" content="${esc(p.name)} — ${esc(price)}"><meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">${img ? `<meta property="og:image" content="${esc(img)}">` : ""}
<meta property="product:price:amount" content="${esc(p.price)}"><meta property="product:price:currency" content="KES">
<meta name="twitter:card" content="${img ? "summary_large_image" : "summary"}">
<meta http-equiv="refresh" content="0;url=/#p${id}"><meta name="viewport" content="width=device-width,initial-scale=1">
<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Product", name: p.name, description: desc, ...(img && { image: img }), ...(p.brand && { brand: { "@type": "Brand", name: p.brand } }), offers: { "@type": "Offer", priceCurrency: "KES", price: Number(p.price), availability: p.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock", url } }).replace(/</g, "\\u003c")}</script>
<script>location.replace("/#p${id}")</script></head>
<body><p><a href="/#p${id}">Open ${esc(p.name)}</a></p></body></html>`);
};
