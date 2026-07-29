import api from './api.js';

/**
 * Notifications raised by Docker discovery.
 *
 *   GET /notifications?type=&unread=true&limit=
 *   GET /notifications/unread-count
 *   PUT /notifications/:id/read
 *   PUT /notifications/read-all
 */

export const NOTIFICATION_TYPES = [
  { value: 'TOOL_DISCOVERED', label: 'Discovered' },
  { value: 'TOOL_STOPPED', label: 'Stopped' },
  { value: 'TOOL_RESTORED', label: 'Restored' },
];

export async function getNotifications({ type, unreadOnly } = {}) {
  const params = {};
  if (type) params.type = type;
  if (unreadOnly) params.unread = 'true';
  const { data } = await api.get('/notifications', { params });
  return data;
}

export async function getUnreadCount() {
  const { data } = await api.get('/notifications/unread-count');
  return data.count;
}

export async function markRead(id) {
  const { data } = await api.put(`/notifications/${id}/read`);
  return data;
}

export async function markAllRead() {
  const { data } = await api.put('/notifications/read-all');
  return data;
}
