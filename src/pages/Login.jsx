import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { DEMO_MODE } from '../authConfig.js';
import cloudfuzeLogo from '../assets/cloudfuze-logo.png';
import './Login.css';

/**
 * Microsoft-only login. Full-page two-panel layout: a CloudFuze-blue brand
 * panel on the left and a white sign-in panel on the right whose leading edge
 * sweeps into it as a large curve.
 *
 * There is no credential form — Microsoft is the only sign-in method — so the
 * right panel carries the welcome and the sign-in action instead of fields.
 */
export default function Login() {
  const { isAuthenticated, login } = useAuth();
  const location = useLocation();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const redirectTo = location.state?.from?.pathname || '/dashboard';

  if (isAuthenticated) {
    return <Navigate to={redirectTo} replace />;
  }

  async function handleLogin(demoRole) {
    setBusy(true);
    try {
      await login(demoRole);
      toast.success('Signed in successfully.');
    } catch (err) {
      toast.error(err.message || 'Sign in failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login">
      {/* ================= LEFT: brand panel ================= */}
      <section className="brand-panel">
        <span className="bp-wash bp-wash--a" aria-hidden="true" />
        <span className="bp-wash bp-wash--b" aria-hidden="true" />
        <span className="bp-mesh" aria-hidden="true" />

        <div className="bp-top">
          {/* Brand rule: white logo on a blue background. */}
          <img className="bp-logo" src={cloudfuzeLogo} alt="CloudFuze" />
        </div>

        <div className="bp-copy">
          <h1 className="bp-title">SAT Monitoring</h1>
          <p className="bp-lede">
            Track every internal application in one place — live status,
            ownership and the teams that depend on it, with clear dashboards and
            instant drill-downs.
          </p>
        </div>

        <MonitorArt />

        <p className="bp-foot">CloudFuze Internal Platform</p>
      </section>

      {/* ================= RIGHT: sign-in panel ================= */}
      <section className="sign-panel">
        <div className="sp-inner">
          <h2 className="sp-title">Welcome back.</h2>
          <p className="sp-hint">Let&apos;s get you signed in.</p>

          <p className="sp-note">
            Access is managed by your CloudFuze Microsoft account.
          </p>

          <button
            className="ms-btn"
            onClick={() => handleLogin('User')}
            disabled={busy}
          >
            {busy ? <Spinner /> : <MicrosoftLogo />}
            {busy ? 'Signing in…' : 'Sign in with Microsoft'}
          </button>

          {DEMO_MODE && (
            <div className="demo-block">
              <div className="rule-text">
                <span />
                <em>Demo mode — preview a role</em>
                <span />
              </div>
              <div className="demo-row">
                <button
                  className="ghost-btn"
                  onClick={() => handleLogin('Admin')}
                  disabled={busy}
                >
                  As Admin
                </button>
                <button
                  className="ghost-btn"
                  onClick={() => handleLogin('User')}
                  disabled={busy}
                >
                  As User
                </button>
              </div>
            </div>
          )}

          <p className="sp-secure">
            <LockIcon />
            Secured by Microsoft Azure AD · CloudFuze employees only
          </p>
        </div>
      </section>
    </div>
  );
}

/**
 * Abstract monitoring illustration for the brand panel: a dashboard surface
 * with a bar chart, a trend line and status rows. Deliberately abstract — the
 * figures are decorative shapes, not readable data.
 */
function MonitorArt() {
  return (
    <div className="bp-art" aria-hidden="true">
      <svg viewBox="0 0 420 300" className="art-svg">
        {/* --- back panel: trend chart --- */}
        <g className="art-float art-float--slow">
          <rect
            x="24"
            y="26"
            width="250"
            height="150"
            rx="10"
            fill="rgba(255,255,255,0.1)"
            stroke="rgba(255,255,255,0.28)"
          />
          {/* gridlines */}
          <g stroke="rgba(255,255,255,0.16)" strokeWidth="1">
            <line x1="44" y1="66" x2="254" y2="66" />
            <line x1="44" y1="101" x2="254" y2="101" />
            <line x1="44" y1="136" x2="254" y2="136" />
          </g>
          {/* trend area + line */}
          <path
            d="M44 141 L84 118 L124 128 L164 92 L204 104 L254 62 L254 156 L44 156 Z"
            fill="rgba(63,214,241,0.18)"
          />
          <path
            className="art-trend"
            d="M44 141 L84 118 L124 128 L164 92 L204 104 L254 62"
            fill="none"
            stroke="#3FD6F1"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {[
            [44, 141],
            [84, 118],
            [124, 128],
            [164, 92],
            [204, 104],
            [254, 62],
          ].map(([cx, cy]) => (
            <circle key={`${cx}`} cx={cx} cy={cy} r="3.2" fill="#fff" />
          ))}
        </g>

        {/* --- front panel: bar chart --- */}
        <g className="art-float">
          <rect
            x="150"
            y="120"
            width="246"
            height="156"
            rx="10"
            fill="rgba(255,255,255,0.16)"
            stroke="rgba(255,255,255,0.34)"
          />
          {/* header dots */}
          <circle cx="168" cy="138" r="3.4" fill="#20CC83" />
          <circle cx="180" cy="138" r="3.4" fill="rgba(255,255,255,0.45)" />
          <circle cx="192" cy="138" r="3.4" fill="rgba(255,255,255,0.28)" />
          <rect
            x="206"
            y="134"
            width="70"
            height="8"
            rx="4"
            fill="rgba(255,255,255,0.3)"
          />
          {/* bars */}
          <g>
            {[
              [172, 60, '#809EFC'],
              [204, 92, '#3FD6F1'],
              [236, 44, '#809EFC'],
              [268, 76, '#14CFC3'],
              [300, 104, '#809EFC'],
              [332, 68, '#3FD6F1'],
            ].map(([x, h, fill], i) => (
              <rect
                key={x}
                className="art-bar"
                style={{ animationDelay: `${i * 0.14}s` }}
                x={x}
                y={256 - h}
                width="18"
                height={h}
                rx="4"
                fill={fill}
              />
            ))}
          </g>
          <line
            x1="164"
            y1="258"
            x2="382"
            y2="258"
            stroke="rgba(255,255,255,0.3)"
            strokeWidth="1.5"
          />
        </g>

        {/* --- floating status chip --- */}
        <g className="art-float art-float--fast">
          <rect
            x="30"
            y="196"
            width="120"
            height="40"
            rx="8"
            fill="rgba(255,255,255,0.2)"
            stroke="rgba(255,255,255,0.36)"
          />
          <circle className="art-pulse" cx="50" cy="216" r="5" fill="#20CC83" />
          <rect
            x="64"
            y="206"
            width="70"
            height="7"
            rx="3.5"
            fill="rgba(255,255,255,0.55)"
          />
          <rect
            x="64"
            y="219"
            width="46"
            height="6"
            rx="3"
            fill="rgba(255,255,255,0.32)"
          />
        </g>
      </svg>
    </div>
  );
}

/* --- Icons --- */

/** Authentic four-square Microsoft logo (per Microsoft brand guidelines). */
function MicrosoftLogo() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#F25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
      <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
      <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
    </svg>
  );
}

function Spinner() {
  return (
    <svg className="btn-spinner" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray="44"
        strokeDashoffset="14"
      />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}
