const { pool } = require("../config/db");
const ApiError = require("../utils/ApiError");

const MAX_AREAS_PER_ADD = 200;

const zoneOut = (z) => ({
  id: z.id, name: z.name, fee: Number(z.fee), free_over: z.free_over === null ? null : Number(z.free_over),
  eta_label: z.eta_label || "", courier: !!z.courier, sort_order: z.sort_order, active: !!z.active,
});

async function listAdmin() {
  const [zones] = await pool.query("SELECT * FROM delivery_zones ORDER BY sort_order, id");
  const [areas] = await pool.query("SELECT id, zone_id, name, county, active FROM delivery_areas ORDER BY name");
  return zones.map((z) => ({ ...zoneOut(z), areas: areas.filter((a) => a.zone_id === z.id).map((a) => ({ id: a.id, name: a.name, county: a.county, active: !!a.active })) }));
}

// What the storefront needs at checkout: only live zones and places.
async function listPublic(globalFreeOver) {
  const zones = (await listAdmin()).filter((z) => z.active);
  return zones.map((z) => ({
    id: z.id, name: z.name, courier: z.courier, fee: z.courier ? 0 : z.fee, eta: z.eta_label,
    // 0 means "free delivery doesn't apply here"
    freeOver: z.courier ? 0 : z.free_over === null ? Number(globalFreeOver) || 0 : z.free_over,
    areas: z.areas.filter((a) => a.active).map((a) => ({ id: a.id, name: a.name, county: a.county })),
  }));
}

function cleanZone(b) {
  const out = {};
  if (b.name !== undefined) out.name = String(b.name).trim().slice(0, 60);
  if (b.fee !== undefined) out.fee = Math.max(0, Math.round(Number(b.fee) || 0));
  if (b.freeOver !== undefined) out.free_over = b.freeOver === null || b.freeOver === "" ? null : Math.max(0, Math.round(Number(b.freeOver) || 0));
  if (b.eta !== undefined) out.eta_label = String(b.eta || "").trim().slice(0, 40) || null;
  if (b.courier !== undefined) out.courier = b.courier ? 1 : 0;
  if (b.active !== undefined) out.active = b.active ? 1 : 0;
  if (b.sortOrder !== undefined) out.sort_order = Math.round(Number(b.sortOrder) || 0);
  return out;
}

async function saveZone(id, body) {
  const v = cleanZone(body);
  if (id) {
    const keys = Object.keys(v);
    if (!keys.length) return true;
    const [r] = await pool.query(`UPDATE delivery_zones SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, [...keys.map((k) => v[k]), id]);
    return r.affectedRows > 0;
  }
  if (!v.name) throw ApiError.badRequest("Give the zone a name.");
  const [[{ next }]] = await pool.query("SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM delivery_zones");
  const [r] = await pool.query(
    "INSERT INTO delivery_zones (name, fee, free_over, eta_label, courier, sort_order, active) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [v.name, v.fee || 0, v.free_over === undefined ? null : v.free_over, v.eta_label || null, v.courier || 0, v.sort_order || next, v.active === undefined ? 1 : v.active]
  );
  return r.insertId;
}

async function deleteZone(id) {
  const [r] = await pool.query("DELETE FROM delivery_zones WHERE id = ?", [id]);
  return r.affectedRows > 0;
}

// Adds many places at once (one per line or comma separated). A place that already exists is moved to this zone.
async function addAreas(zoneId, names, county) {
  const [[z]] = await pool.query("SELECT id FROM delivery_zones WHERE id = ?", [zoneId]);
  if (!z) return null;
  const list = [...new Set(String(names || "").split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean).map((s) => s.slice(0, 80)))].slice(0, MAX_AREAS_PER_ADD);
  const c = String(county || "").trim().slice(0, 40);
  if (!list.length) throw ApiError.badRequest("Enter at least one place name.");
  if (!c) throw ApiError.badRequest("Choose the county these places are in.");
  for (const n of list) {
    await pool.query("INSERT INTO delivery_areas (zone_id, name, county) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE zone_id = VALUES(zone_id), active = 1", [zoneId, n, c]);
  }
  return list.length;
}

async function saveArea(id, body) {
  const sets = [], vals = [];
  if (body.name !== undefined) { sets.push("name = ?"); vals.push(String(body.name).trim().slice(0, 80)); }
  if (body.county !== undefined) { sets.push("county = ?"); vals.push(String(body.county).trim().slice(0, 40)); }
  if (body.zoneId !== undefined) { sets.push("zone_id = ?"); vals.push(Number(body.zoneId)); }
  if (body.active !== undefined) { sets.push("active = ?"); vals.push(body.active ? 1 : 0); }
  if (!sets.length) return true;
  const [r] = await pool.query(`UPDATE delivery_areas SET ${sets.join(", ")} WHERE id = ?`, [...vals, id]);
  return r.affectedRows > 0;
}
async function deleteArea(id) {
  const [r] = await pool.query("DELETE FROM delivery_areas WHERE id = ?", [id]);
  return r.affectedRows > 0;
}

/**
 * Works out where an order is going and what delivery costs — always from the database,
 * never from the browser. Returns { county, area, zoneName, fee, pending }.
 *  - areaId        → a listed place: its zone's fee (free above the zone's / shop's threshold)
 *  - zoneId+town   → a courier zone: fee is left for the shop to quote (pending)
 *  - neither       → older clients: the flat fee from Settings
 */
async function quote(conn, input, subtotal, settings) {
  const globalFree = Number(settings.free_delivery_threshold) || 0;
  if (input.areaId) {
    const [[a]] = await conn.query(
      `SELECT a.name AS area, a.county, z.name AS zone_name, z.fee, z.free_over, z.courier
       FROM delivery_areas a JOIN delivery_zones z ON z.id = a.zone_id WHERE a.id = ? AND a.active = 1 AND z.active = 1`, [input.areaId]);
    if (!a) throw ApiError.badRequest("We no longer deliver to that area. Please choose another.");
    if (a.courier) return { county: a.county, area: a.area, zoneName: a.zone_name, fee: 0, pending: true };
    const freeOver = a.free_over === null ? globalFree : Number(a.free_over);
    return { county: a.county, area: a.area, zoneName: a.zone_name, fee: freeOver > 0 && subtotal >= freeOver ? 0 : Number(a.fee), pending: false };
  }
  if (input.zoneId) {
    const [[z]] = await conn.query("SELECT id, name, courier FROM delivery_zones WHERE id = ? AND active = 1", [input.zoneId]);
    if (!z || !z.courier) throw ApiError.badRequest("Choose your delivery area from the list.");
    const town = String(input.town || "").trim();
    if (town.length < 2) throw ApiError.badRequest("Enter your town so we can quote the courier charge.");
    return { county: input.county, area: town.slice(0, 80), zoneName: z.name, fee: 0, pending: true };
  }
  return { county: input.county, area: null, zoneName: null, fee: globalFree > 0 && subtotal >= globalFree ? 0 : Number(settings.delivery_fee), pending: false };
}

module.exports = { listAdmin, listPublic, saveZone, deleteZone, addAreas, saveArea, deleteArea, quote };
