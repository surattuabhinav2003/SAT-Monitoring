import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import {
  getNotifications,
  markRead,
  markAllRead,
  NOTIFICATION_TYPES,
} from '../services/notificationService.js';
import './Notifications.css';

const TYPE_META = {
  TOOL_DISCOVERED: { label: 'Discovered', tone: 'info', icon: PlusCircleIcon },
  TOOL_STOPPED: { label: 'Stopped', tone: 'danger', icon: AlertIcon },
  TOOL_RESTORED: { label: 'Restored', tone: 'success', icon: CheckIcon },
};

/**
 * Notifications raised by Docker discovery: tools appearing, stopping and
 * recovering. Newest first, filterable by type, with unread tracking.
 */
export default function Notifications() {
  const { isAdmin } = useAuth();
  const toast = useToast();

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState('');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await getNotifications({ type: typeFilter, unreadOnly }));
    } catch (err) {
      toast.error(err.message || 'Could not load notifications.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, unreadOnly]);

  useEffect(() => {
    load();
  }, [load]);

  const unreadCount = useMemo(() => items.filter((n) => !n.isRead).length, [items]);

  async function handleMarkRead(id) {
    setBusyId(id);
    try {
      await markRead(id);
      // Reflect locally rather than refetching, so the row does not jump away
      // while the user is still reading it.
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
    } catch (err) {
      toast.error(err.message || 'Could not mark as read.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleMarkAll() {
    try {
      const { updated } = await markAllRead();
      toast.success(`${updated} notification${updated === 1 ? '' : 's'} marked as read.`);
      await load();
    } catch (err) {
      toast.error(err.message || 'Could not mark all as read.');
    }
  }

  return (
    <div className="notifications-page">
      <header className="page-head">
        <div>
          <h1>Notifications</h1>
          <p>
            Raised automatically when Docker discovery finds a new tool, or when
            a tool stops or comes back.
          </p>
        </div>

        {isAdmin && unreadCount > 0 && (
          <div className="page-head-actions">
            <button className="btn btn--ghost" onClick={handleMarkAll}>
              Mark all as read
            </button>
          </div>
        )}
      </header>

      <div className="notif-toolbar">
        <div className="notif-tabs">
          <button
            className={`notif-tab ${typeFilter === '' ? 'is-active' : ''}`}
            onClick={() => setTypeFilter('')}
          >
            All
          </button>
          {NOTIFICATION_TYPES.map((t) => (
            <button
              key={t.value}
              className={`notif-tab ${typeFilter === t.value ? 'is-active' : ''}`}
              onClick={() => setTypeFilter(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <label className="notif-unread-toggle">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(e) => setUnreadOnly(e.target.checked)}
          />
          Unread only
          {unreadCount > 0 && <span className="notif-count">{unreadCount}</span>}
        </label>
      </div>

      {loading ? (
        <LoadingSpinner label="Loading notifications…" />
      ) : items.length === 0 ? (
        <div className="notif-empty">
          <p>
            {unreadOnly || typeFilter
              ? 'No notifications match this filter.'
              : 'No notifications yet. They appear when discovery detects a change.'}
          </p>
        </div>
      ) : (
        <ul className="notif-list">
          {items.map((n) => {
            const meta = TYPE_META[n.type] || {
              label: n.type,
              tone: 'info',
              icon: PlusCircleIcon,
            };
            const Icon = meta.icon;
            return (
              <li
                key={n.id}
                className={`notif-item notif-item--${meta.tone} ${
                  n.isRead ? 'is-read' : ''
                }`}
              >
                <span className={`notif-icon notif-icon--${meta.tone}`}>
                  <Icon />
                </span>

                <div className="notif-body">
                  <div className="notif-head">
                    <span className={`badge notif-badge--${meta.tone}`}>{meta.label}</span>
                    <Link to="/applications" className="notif-app">
                      {n.applicationName}
                    </Link>
                    {!n.isRead && <span className="notif-dot" aria-label="Unread" />}
                    <time className="notif-time" dateTime={n.createdAt}>
                      {formatWhen(n.createdAt)}
                    </time>
                  </div>

                  {/* Messages are multi-line by design; preserve the breaks. */}
                  <p className="notif-message">{n.message}</p>
                </div>

                {isAdmin && !n.isRead && (
                  <button
                    className="notif-read-btn"
                    onClick={() => handleMarkRead(n.id)}
                    disabled={busyId === n.id}
                  >
                    {busyId === n.id ? '…' : 'Mark read'}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function formatWhen(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const mins = Math.round((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min${mins === 1 ? '' : 's'} ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? '' : 's'} ago`;
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/* --- Icons --- */
function AlertIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    </svg>
  );
}
function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <path d="M22 4 12 14.01l-3-3" />
    </svg>
  );
}
function PlusCircleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  );
}
