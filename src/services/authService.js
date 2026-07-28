import api from './api.js';

/**
 * Resolve the signed-in user's identity and role.
 *
 *   GET /users/me  ->  { email, name, role: 'Admin' | 'User' }
 *
 * Identity comes from the verified bearer token server-side, and the role from
 * the `admins` table — so a grant on the Admin Access page takes effect on that
 * person's next sign-in, and nothing here can be spoofed by the client.
 *
 * Returns null when the session is not valid, so callers can treat the user as
 * signed out. Never returns elevated access on error.
 */
export async function fetchMyProfile() {
  try {
    const { data } = await api.get('/users/me');
    return {
      email: data.email,
      name: data.name,
      role: data.role === 'Admin' ? 'Admin' : 'User',
    };
  } catch {
    return null;
  }
}
