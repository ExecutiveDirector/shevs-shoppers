const accountModel = require("../models/accountModel");
const settingsModel = require("../models/settingsModel");
const mailer = require("../utils/mailer");
const auth = require("../utils/auth");
const asyncHandler = require("../utils/asyncHandler");
const ApiError = require("../utils/ApiError");

const session = (user) => ({ token: auth.issueToken(user), user: accountModel.publicUser(user) });

const register = asyncHandler(async (req, res) => {
  const user = await accountModel.register(req.body);
  res.status(201).json(session(user));
});

const login = asyncHandler(async (req, res) => {
  const user = await accountModel.login(req.body.login, req.body.password);
  // Same message whether the account exists or not.
  if (!user) throw new ApiError(401, "Wrong phone/email or password.");
  res.json(session(user));
});

const me = asyncHandler(async (req, res) => res.json({ user: accountModel.publicUser(req.user) }));

const updateMe = asyncHandler(async (req, res) => {
  const before = req.user;
  const user = await accountModel.updateProfile(before, req.body);
  // A password change signs out other devices, so hand this one a fresh token.
  res.json(req.body.newPassword ? session(user) : { user: accountModel.publicUser(user) });
});

const orders = asyncHandler(async (req, res) => res.json({ orders: await accountModel.listOrders(req.user.id) }));

const claim = asyncHandler(async (req, res) => {
  await accountModel.claimOrder(req.user.id, req.body.orderCode, req.body.phone);
  res.json({ ok: true, orders: await accountModel.listOrders(req.user.id) });
});

const forgot = asyncHandler(async (req, res) => {
  const user = await accountModel.findByLogin(req.body.login);
  if (user && user.email && mailer.configured()) {
    const code = await accountModel.startReset(user);
    const shop = (await settingsModel.getAll()).shop_name;
    mailer.send({ to: user.email, ...mailer.resetEmail(code, shop) }).catch(() => {});
  }
  // Never reveal whether the account exists.
  res.json({ ok: true, message: "If that account has an email address, we've sent a 6-digit code to it. No email on your account? Message the shop on WhatsApp and we'll reset it for you." });
});

const reset = asyncHandler(async (req, res) => {
  const user = await accountModel.findByLogin(req.body.login);
  if (!user) throw ApiError.badRequest("That code isn't right or has expired. Request a new one.");
  await accountModel.finishReset(user, req.body.code, req.body.newPassword);
  res.json(session(await accountModel.findById(user.id)));
});

/* admin: let the owner help someone who is locked out */
const adminResetPassword = asyncHandler(async (req, res) => {
  const temp = await accountModel.adminSetTempPassword(Number(req.params.id));
  if (!temp) throw ApiError.notFound("Account not found.");
  res.json({ ok: true, temporaryPassword: temp });
});

module.exports = { register, login, me, updateMe, orders, claim, forgot, reset, adminResetPassword };
