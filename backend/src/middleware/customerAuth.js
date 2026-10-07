const auth = require("../utils/auth");
const accountModel = require("../models/accountModel");
const ApiError = require("../utils/ApiError");

async function load(req) {
  const m = /^Bearer (.+)$/.exec(req.get("authorization") || "");
  if (!m) return null;
  const p = auth.readToken(m[1]);
  if (!p) return null;
  const user = await accountModel.findById(p.u);
  // The fingerprint stops working the moment the password changes.
  return user && auth.fingerprint(user.password_hash) === p.f ? user : null;
}

// Signed-in customers only.
const requireCustomer = async (req, res, next) => {
  try {
    const user = await load(req);
    if (!user) return next(new ApiError(401, "Please sign in to continue."));
    req.user = user;
    next();
  } catch (e) { next(e); }
};
// Works for guests and signed-in customers; sets req.user when there is one.
const optionalCustomer = async (req, res, next) => {
  try { req.user = await load(req); } catch { req.user = null; }
  next();
};

module.exports = { requireCustomer, optionalCustomer };
