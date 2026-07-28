import { LogLevel } from '@azure/msal-browser';

/**
 * Read configuration from Vite environment variables.
 * See .env.example for the full list of supported keys.
 */
const CLIENT_ID = import.meta.env.VITE_AZURE_CLIENT_ID || 'YOUR_AZURE_CLIENT_ID';
const TENANT_ID = import.meta.env.VITE_AZURE_TENANT_ID || 'common';
const REDIRECT_URI = import.meta.env.VITE_AZURE_REDIRECT_URI || window.location.origin;

/**
 * DEMO_MODE is enabled automatically until a real Azure Client ID is provided.
 * When enabled, the AuthContext simulates the Microsoft popup so the app can be
 * explored without a configured Entra ID tenant.
 *
 * It affects AUTHENTICATION ONLY. Application and admin data always come from
 * PostgreSQL via the REST API, so the backend must be running either way.
 *
 * To switch to real Microsoft authentication, set VITE_AZURE_CLIENT_ID (and
 * VITE_AZURE_TENANT_ID) in a .env file. No code changes are required.
 */
export const DEMO_MODE = CLIENT_ID === 'YOUR_AZURE_CLIENT_ID';

// MSAL client configuration.
export const msalConfig = {
  auth: {
    clientId: CLIENT_ID,
    authority: `https://login.microsoftonline.com/${TENANT_ID}`,
    redirectUri: REDIRECT_URI,
    postLogoutRedirectUri: REDIRECT_URI,
  },
  cache: {
    cacheLocation: 'localStorage',
    storeAuthStateInCookie: false,
  },
  system: {
    loggerOptions: {
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) return;
        if (level === LogLevel.Error) console.error(message);
      },
    },
  },
};

// Scopes requested during interactive login. The app reads the signed-in user's
// name and email from the ID token and never calls Microsoft Graph, so these
// are the OIDC basics only.
export const loginRequest = {
  scopes: ['openid', 'profile', 'email'],
};

/**
 * Scope for this project's own API, exposed on the same app registration
 * ("Expose an API" -> Add a scope). Defaults to the Application ID URI that
 * Entra ID generates by default.
 */
export const API_SCOPE =
  import.meta.env.VITE_API_SCOPE || `api://${CLIENT_ID}/access_as_user`;

/** Token request used before every API call. */
export const apiTokenRequest = {
  scopes: [API_SCOPE],
};
