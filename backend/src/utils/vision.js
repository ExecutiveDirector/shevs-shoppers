const ApiError = require("./ApiError");

// Optional: recognise what a product photo shows using Claude's vision, so photos can be matched to products
// without being named. Needs ANTHROPIC_API_KEY (Railway variable). Without it the feature is simply switched off.
const enabled = () => !!process.env.ANTHROPIC_API_KEY;
const model = () => process.env.VISION_MODEL || "claude-haiku-4-5-20251001";

const clean = (s, n) => String(s == null ? "" : s).replace(/\s+/g, " ").trim().slice(0, n);

/**
 * products: [{id, name, brand, category, colors:[...]}]
 * image: Buffer (JPEG/PNG/WebP/GIF), mediaType: its MIME type.
 * Returns { productId|null, confidence: "high"|"medium"|"low", color|null }.
 */
async function identify(image, mediaType, products) {
  if (!enabled()) throw new ApiError(503, "Photo recognition isn't switched on. Add ANTHROPIC_API_KEY to enable it.");
  const catalogue = products.map((p) => `${p.id} | ${clean(p.name, 80)}${p.brand ? " | " + clean(p.brand, 30) : ""} | ${clean(p.category, 30)}`).join("\n");
  const body = {
    model: model(),
    max_tokens: 200,
    system: [
      {
        type: "text",
        text:
          "You match product photos to the items of ONE shop's catalogue. Look at the photo and pick the catalogue item it shows. " +
          "Items can come in several colours or sizes; the same product in another colour is still the same product.\n" +
          "Reply with JSON only, no other text: {\"productId\": <id from the list or null>, \"confidence\": \"high\"|\"medium\"|\"low\", \"color\": <main colour of the item as one or two plain words, or null>}.\n" +
          "Use null if no catalogue item clearly matches. Never invent an id.\n\nCATALOGUE (id | name | brand | category):\n" + catalogue,
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [
      { role: "user", content: [{ type: "image", source: { type: "base64", media_type: mediaType, data: image.toString("base64") } }, { type: "text", text: "Which catalogue item is this?" }] },
    ],
  };
  let res;
  try {
    res = await fetch(process.env.ANTHROPIC_API_URL || "https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new ApiError(502, "Couldn't reach the recognition service. Try again.");
  }
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    if (res.status === 401) throw new ApiError(502, "The ANTHROPIC_API_KEY on the server was rejected.");
    if (res.status === 429) throw new ApiError(429, "Recognition is busy. Wait a few seconds and try again.");
    throw new ApiError(502, `Recognition failed (${res.status}). ${t.slice(0, 120)}`);
  }
  const data = await res.json();
  const text = (data.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
  let out;
  try { out = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)); } catch { return { productId: null, confidence: "low", color: null }; }
  const ids = new Set(products.map((p) => p.id));
  const productId = Number.isInteger(out.productId) && ids.has(out.productId) ? out.productId : null;
  const confidence = ["high", "medium", "low"].includes(out.confidence) ? out.confidence : "low";
  return { productId, confidence: productId ? confidence : "low", color: out.color ? clean(out.color, 40) : null };
}

module.exports = { enabled, identify };
