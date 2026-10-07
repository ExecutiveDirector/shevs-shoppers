const { OAuth2Client } = require("google-auth-library");
const ApiError = require("./ApiError");

const clientId = () => (process.env.GOOGLE_CLIENT_ID || "").trim();
const configured = () => !!clientId();

let client;
// Verifies the signature, expiry and audience of the ID token Google handed the browser.
// Returns the Google profile only when the token was issued for THIS shop's client id.
async function verify(idToken) {
  if (!configured()) throw new ApiError(503, "Google sign-in isn't set up yet.");
  client = client || new OAuth2Client();
  let p;
  try {
    const ticket = await client.verifyIdToken({ idToken, audience: clientId() });
    p = ticket.getPayload();
  } catch {
    throw new ApiError(401, "We couldn't verify your Google sign-in. Please try again.");
  }
  if (!p || !p.sub || !p.email || p.email_verified !== true) throw new ApiError(401, "Your Google email isn't verified.");
  return { sub: p.sub, email: p.email.toLowerCase(), name: (p.name || p.email.split("@")[0]).slice(0, 80) };
}

module.exports = { verify, configured, clientId };
