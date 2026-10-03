/**
 * An error carrying an HTTP status code, thrown anywhere in a route/service
 * and turned into a clean JSON response by the central error handler.
 */
class ApiError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.statusCode = statusCode;
    this.details = details;
    this.isApiError = true;
  }

  static badRequest(message, details) {
    return new ApiError(400, message, details);
  }
  static notFound(message = "Not found") {
    return new ApiError(404, message);
  }
  static conflict(message) {
    return new ApiError(409, message);
  }
  static unauthorized(message = "Unauthorized") {
    return new ApiError(401, message);
  }
}

module.exports = ApiError;
