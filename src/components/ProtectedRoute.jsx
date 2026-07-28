import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import LoadingSpinner from './LoadingSpinner.jsx';

/**
 * Guards routes that require an authenticated Microsoft user.
 * While auth state is resolving we show a spinner; unauthenticated users are
 * redirected to /login (preserving the intended destination).
 *
 * Pass `requireAdmin` to additionally restrict the route to admins — a
 * non-admin who reaches the URL directly is sent back to the dashboard rather
 * than shown the page.
 */
export default function ProtectedRoute({ children, requireAdmin = false }) {
  const { isAuthenticated, isAdmin, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return <LoadingSpinner fullPage label="Checking your session…" />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (requireAdmin && !isAdmin) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
