const { validationResult } = require("express-validator");
const ApiError = require("../utils/ApiError");

// Run after a set of express-validator check(...) rules; turns any
// validation failures into one consistent 400 response shape.
function validate(req, res, next) {
  const result = validationResult(req);
  if (!result.isEmpty()) {
    const details = result.array().map((e) => ({ field: e.path, message: e.msg }));
    return next(ApiError.badRequest("Please check the highlighted fields.", details));
  }
  next();
}

module.exports = validate;
