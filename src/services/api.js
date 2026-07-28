import axios from 'axios';

/**
 * Central Axios instance. Every service imports this so base URL, headers,
 * and interceptors are configured in exactly one place.
 */
const api = axios.create({
  // Relative by default: the Vite dev server proxies /api to the backend, and
  // in production the SPA is served from the same origin as the API. Set
  // VITE_API_BASE_URL only when the API lives on a different origin.
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 15000,
  headers: {
    'Content-Type': 'application/json',
  },
});

/**
 * Supplies the bearer token for outgoing requests.
 *
 * AuthContext registers a provider once MSAL is ready (see
 * `setAuthTokenProvider`). Keeping it injected rather than reaching into MSAL
 * from here avoids a circular import and keeps this module free of auth logic.
 *
 * Returning null is normal — in demo mode there is no token, and the backend's
 * DEV_AUTH_BYPASS covers local development.
 */
let getAuthToken = async () => null;

export function setAuthTokenProvider(provider) {
  getAuthToken = provider || (async () => null);
}

/** Called on a 401 so the app can clear its session and return to /login. */
let onUnauthorized = null;

export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

/**
 * Request interceptor: attach a fresh access token.
 *
 * The provider re-acquires silently when the cached token is close to expiry,
 * so a long-lived tab keeps working without the user signing in again.
 */
api.interceptors.request.use(
  async (config) => {
    try {
      const token = await getAuthToken();
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
    } catch {
      // Let the request go out unauthenticated — the API will answer 401 and
      // the response interceptor handles it in one place.
    }
    return config;
  },
  (error) => Promise.reject(error)
);

/**
 * Response interceptor: normalize errors into a friendly message.
 */
api.interceptors.response.use(
  (response) => response,
  (error) => {
    // No response at all means the API isn't reachable — say so plainly rather
    // than surfacing axios's bare "Network Error".
    if (!error.response) {
      return Promise.reject(
        new Error(
          'Cannot reach the SAT Monitoring API. Make sure the backend and database are running (docker compose up).'
        )
      );
    }

    const { status } = error.response;

    // The token is missing, expired or rejected — end the session so the user
    // is sent back to sign-in rather than seeing repeated failures.
    if (status === 401 && onUnauthorized) {
      onUnauthorized();
      return Promise.reject(new Error('Your session has expired. Please sign in again.'));
    }

    if (status === 403) {
      return Promise.reject(
        new Error(
          error.response.data?.message ||
            'You do not have permission to perform this action.'
        )
      );
    }

    const message =
      error.response.data?.message ||
      error.message ||
      'An unexpected error occurred while contacting the server.';
    return Promise.reject(new Error(message));
  }
);

export default api;
