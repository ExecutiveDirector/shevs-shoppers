const router = require("express").Router();
const c = require("../controllers/accountController");
const validate = require("../middleware/validate");
const { requireCustomer } = require("../middleware/customerAuth");
const { accountLimiter, registerLimiter } = require("../middleware/rateLimiters");
const engagement = require("../controllers/engagementController");
const { formLimiter } = require("../middleware/rateLimiters");
const { myReviewRules, registerRules, loginRules, profileRules, claimRules, forgotRules, resetRules, googleRules } = require("../validators/orderValidator");

router.get("/config", c.config);
router.post("/google", accountLimiter, googleRules, validate, c.googleSignIn);
router.post("/register", registerLimiter, accountLimiter, registerRules, validate, c.register);
router.post("/login", accountLimiter, loginRules, validate, c.login);
router.post("/forgot", accountLimiter, forgotRules, validate, c.forgot);
router.post("/reset", accountLimiter, resetRules, validate, c.reset);

router.get("/me", requireCustomer, c.me);
router.patch("/me", requireCustomer, accountLimiter, profileRules, validate, c.updateMe);
router.get("/orders", requireCustomer, c.orders);
router.get("/reviewable", requireCustomer, engagement.myReviewable);
router.post("/reviews", requireCustomer, formLimiter, myReviewRules, validate, engagement.submitMine);
router.post("/orders/claim", requireCustomer, accountLimiter, claimRules, validate, c.claim);

module.exports = router;
