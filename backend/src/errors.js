/**
 * Error plumbing shared by all routes.
 *
 * The SPA's axios interceptor reads `error.response.data.message`, so every
 * failure must return a JSON body of the shape { message }.
 */

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** Wrap an async handler so a rejected promise reaches the error middleware. */
export function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

/**
 * Terminal error handler — must be registered last.
 *
 * Honours a client-error status from anywhere, not just ApiError: express.json()
 * raises a SyntaxError carrying `status: 400` for a malformed body, and that
 * must stay a 400 rather than being reported as a server fault.
 */
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  const declared = Number(err.status || err.statusCode);
  const status =
    Number.isInteger(declared) && declared >= 400 && declared < 600 ? declared : 500;

  if (status >= 500) {
    console.error('[api] unhandled error:', err);
  }

  let message;
  if (status >= 500) {
    message = 'An unexpected server error occurred.';
  } else if (err.type === 'entity.parse.failed') {
    message = 'Request body is not valid JSON.';
  } else {
    message = err.message || 'Request failed.';
  }

  res.status(status).json({ message });
}

export function notFoundHandler(req, res) {
  res.status(404).json({ message: `No route for ${req.method} ${req.originalUrl}` });
}
