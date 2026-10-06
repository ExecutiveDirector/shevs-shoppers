const { origin } = require("./_lib");
module.exports = (req, res) => {
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Cache-Control", "public, s-maxage=86400");
  // The admin panel isn't meant to appear in search results.
  res.end(`User-agent: *\nAllow: /\nDisallow: /admin/\n\nSitemap: ${origin(req)}/sitemap.xml\n`);
};
