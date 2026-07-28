import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { useMsal } from '@azure/msal-react';
import { InteractionStatus, InteractionRequiredAuthError } from '@azure/msal-browser';

import { loginRequest, apiTokenRequest, DEMO_MODE } from '../authConfig.js';
import { fetchMyProfile } from '../services/authService.js';
import { setAuthTokenProvider, setUnauthorizedHandler } from '../services/api.js';

const AuthContext = createContext(null);

const DEMO_STORAGE_KEY = 'sat-demo-user';

/**
 * Central authentication + user-state store.
 *
 * Responsibilities:
 *  - Trigger Microsoft (MSAL) login / logout.
 *  - Acquire an access token for this project's API and hand it to the axios
 *    layer, refreshing it silently as it nears expiry.
 *  - Resolve the user's role (Admin | User) from the backend.
 *  - Expose { user, role, isAuthenticated, isAdmin, loading } to the app.
 *
 * In DEMO_MODE the Microsoft popup is simulated so the app is usable without a
 * configured Azure tenant. Application data still comes from the API, which
 * must be running with DEV_AUTH_BYPASS enabled.
 */
export function AuthProvider({ children }) {
  const { instance, accounts, inProgress } = useMsal();

  const [user, setUser] = useState(null);
  const [role, setRole] = useState(null);
  const [loading, setLoading] = useState(true);

  // --- Give the axios layer a way to fetch a current API token. ---
  useEffect(() => {
    if (DEMO_MODE) {
      // No real tokens exist in demo mode; the API runs with DEV_AUTH_BYPASS.
      setAuthTokenProvider(async () => null);
      return;
    }

    setAuthTokenProvider(async () => {
      const account = instance.getActiveAccount() || accounts[0];
      if (!account) return null;

      // Preferred: an access token for this API's own scope. MSAL serves it from
      // cache and only hits the network when it is expired or close to it.
      try {
        const result = await instance.acquireTokenSilent({
          ...apiTokenRequest,
          account,
        });
        if (result.accessToken) return result.accessToken;
      } catch (err) {
        // Expected until the app registration exposes api://<client-id>/access_as_user
        // (Azure answers AADSTS500011). Fall through to the ID token, which the
        // API also accepts — its audience is the same client id.
        if (!(err instanceof InteractionRequiredAuthError)) {
          console.warn(
            '[auth] API scope unavailable, using the ID token instead:',
            err.errorCode || err.message
          );
        }
      }

      // Fallback: the ID token. Same signature, issuer and audience checks apply
      // server-side, so this is safe — just less granular than a scoped token.
      try {
        const result = await instance.acquireTokenSilent({
          ...loginRequest,
          account,
        });
        if (result.idToken) return result.idToken;
      } catch {
        // Ignore and use the cached token below.
      }

      // Last resort: the raw ID token already on the account. Used only if the
      // silent call above failed, so it may be closer to expiry.
      return account.idToken || null;
    });
  }, [instance, accounts]);

  // --- Establish a user profile once MSAL / demo state settles. ---
  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      if (DEMO_MODE) {
        const saved = localStorage.getItem(DEMO_STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          if (!cancelled) {
            setUser(parsed);
            setRole(parsed.role);
          }
        }
        if (!cancelled) setLoading(false);
        return;
      }

      // Real MSAL flow: wait for any in-flight interaction to finish.
      if (inProgress !== InteractionStatus.None) return;

      const account = instance.getActiveAccount() || accounts[0];
      if (account) {
        // The backend resolves identity and role from the token, so this is the
        // authoritative answer rather than anything read client-side.
        const profile = await fetchMyProfile();
        if (!cancelled) {
          if (profile) {
            setUser({
              name: profile.name || account.name,
              email: profile.email || account.username,
              id: account.localAccountId,
              role: profile.role,
            });
            setRole(profile.role);
          } else {
            // Signed in with Microsoft but the API rejected us — treat it as
            // not signed in rather than showing a broken shell.
            setUser(null);
            setRole(null);
          }
        }
      }
      if (!cancelled) setLoading(false);
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [instance, accounts, inProgress]);

  // --- Microsoft login ---
  const login = useCallback(
    async (demoRole = 'User') => {
      if (DEMO_MODE) {
        const demoUser = {
          name: demoRole === 'Admin' ? 'Alex Admin' : 'Jordan User',
          email: demoRole === 'Admin' ? 'admin@cloudfuze.com' : 'user@cloudfuze.com',
          id: `demo-${demoRole.toLowerCase()}`,
          role: demoRole,
        };
        localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(demoUser));
        setUser(demoUser);
        setRole(demoRole);
        return demoUser;
      }

      // Full-page redirect rather than a popup: no popup blockers, and it works
      // consistently in embedded/enterprise browsers.
      //
      // Only OIDC scopes are requested here. Asking for the API scope at sign-in
      // would hard-fail with AADSTS500011 until the registration exposes it; the
      // token provider requests it separately and falls back when it is absent.
      //
      // This navigates away, so nothing after it runs. The bootstrap effect
      // picks the session up when the browser returns.
      await instance.loginRedirect(loginRequest);
      return null;
    },
    [instance]
  );

  // --- Logout ---
  const logout = useCallback(async () => {
    if (DEMO_MODE) {
      localStorage.removeItem(DEMO_STORAGE_KEY);
      setUser(null);
      setRole(null);
      return;
    }
    // Redirect to match the sign-in flow; this navigates away.
    await instance.logoutRedirect({ postLogoutRedirectUri: window.location.origin });
  }, [instance]);

  // --- Clear local session when the API reports the token is no longer valid. ---
  useEffect(() => {
    setUnauthorizedHandler(() => {
      if (DEMO_MODE) return; // demo sessions aren't token-backed
      setUser(null);
      setRole(null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const value = {
    user,
    role,
    isAuthenticated: !!user,
    isAdmin: role === 'Admin',
    loading,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
