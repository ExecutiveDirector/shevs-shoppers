const ApiError = require("../utils/ApiError");

function notFoundHandler(req, res) {
  res.status(404).json({ error: { message: `No route for ${req.method} ${req.originalUrl}` } });
}

// Express recognizes this as an error handler by its 4-argument signature.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  // Malformed or oversized JSON bodies are the client's fault, not a 500.
  if (err.type === "entity.parse.failed") err = ApiError.badRequest("Request body isn't valid JSON.");
  else if (err.type === "entity.too.large") err = new ApiError(413, "Request body is too large.");

  const isKnown = err instanceof ApiError || err.isApiError;
  const statusCode = isKnown ? err.statusCode : 500;

  if (!isKnown) {
    // Unexpected errors (DB down, bugs) are logged in full server-side,
    // but never leaked to the client beyond a generic message.
    console.error("Unhandled error:", err);
  }

  res.status(statusCode).json({
    error: {
      message: isKnown ? err.message : "Something went wrong. Please try again.",
      ...(isKnown && err.details ? { details: err.details } : {}),
    },
  });
}

module.exports = { notFoundHandler, errorHandler };
