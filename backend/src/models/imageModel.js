const sharp = require("sharp");
const { pool } = require("../config/db");

sharp.cache(false);

// Re-encoding through sharp also strips metadata (GPS etc.) and rejects
// anything that isn't a real image, so a renamed .exe can't get through.
async function create(buffer) {
  const base = sharp(buffer, { failOn: "error", limitInputPixels: 50e6 }).rotate();
  const meta = await base.metadata();
  if (!["jpeg", "png", "webp", "gif", "heif"].includes(meta.format)) throw new Error("unsupported");
  const large = await base.clone().resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
  const thumb = await base.clone().resize({ width: 400, height: 400, fit: "inside", withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
  const [r] = await pool.query("INSERT INTO product_images (large, thumb, width, height) VALUES (?, ?, ?, ?)", [
    large.data, thumb, large.info.width, large.info.height,
  ]);
  return { id: r.insertId, width: large.info.width, height: large.info.height };
}

async function get(id, variant) {
  const col = variant === "thumb" ? "thumb" : "large";
  const [rows] = await pool.query(`SELECT ${col} AS data FROM product_images WHERE id = ?`, [id]);
  return rows[0] ? rows[0].data : null;
}

module.exports = { create, get };
