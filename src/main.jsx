import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { PublicClientApplication, EventType } from '@azure/msal-browser';
import { MsalProvider } from '@azure/msal-react';

import App from './App.jsx';
import { msalConfig, DEMO_MODE } from './authConfig.js';
import { AuthProvider } from './context/AuthContext.jsx';

import './styles/variables.css';
import './styles/global.css';

const msalInstance = new PublicClientApplication(msalConfig);

/**
 * Bootstrap MSAL, then render.
 *
 * Order matters with @azure/msal-browser v3:
 *   1. `initialize()` must complete before ANY other instance method — calling
 *      e.g. getAllAccounts() first throws `uninitialized_public_client_application`.
 *   2. `handleRedirectPromise()` must run on load to finish a redirect sign-in;
 *      the app returns from Microsoft with the response in the URL and this is
 *      what consumes it.
 *
 * In DEMO_MODE the instance is still created so the provider tree is consistent,
 * but AuthContext short-circuits every network call with a simulated account.
 */
async function bootstrap() {
  await msalInstance.initialize();

  if (!DEMO_MODE) {
    try {
      // Completes a redirect login if we're returning from Microsoft; resolves
      // null on a normal page load.
      const result = await msalInstance.handleRedirectPromise();
      if (result?.account) {
        msalInstance.setActiveAccount(result.account);
      }
    } catch (err) {
      // A failed redirect must not block the app from rendering — the login
      // page will simply show as signed out.
      console.error('[auth] redirect sign-in failed:', err);
    }

    if (!msalInstance.getActiveAccount()) {
      const accounts = msalInstance.getAllAccounts();
      if (accounts.length > 0) msalInstance.setActiveAccount(accounts[0]);
    }

    msalInstance.addEventCallback((event) => {
      if (event.eventType === EventType.LOGIN_SUCCESS && event.payload?.account) {
        msalInstance.setActiveAccount(event.payload.account);
      }
    });
  }

  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <MsalProvider instance={msalInstance}>
        <AuthProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </AuthProvider>
      </MsalProvider>
    </React.StrictMode>
  );
}

bootstrap();
