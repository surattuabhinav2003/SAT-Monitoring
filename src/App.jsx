import { Routes, Route, Navigate } from 'react-router-dom';

import MainLayout from './layouts/MainLayout.jsx';
import ProtectedRoute from './components/ProtectedRoute.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Applications from './pages/Applications.jsx';
import AdminAccess from './pages/AdminAccess.jsx';
import NotFound from './pages/NotFound.jsx';
import { ToastProvider } from './context/ToastContext.jsx';

/**
 * Application route tree.
 *  - /login is public.
 *  - Everything under MainLayout is protected and requires a Microsoft login.
 *  - /admin-access additionally requires the Admin role.
 */
export default function App() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route
          element={
            <ProtectedRoute>
              <MainLayout />
            </ProtectedRoute>
          }
        >
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/applications" element={<Applications />} />
          <Route
            path="/admin-access"
            element={
              <ProtectedRoute requireAdmin>
                <AdminAccess />
              </ProtectedRoute>
            }
          />
        </Route>

        <Route path="*" element={<NotFound />} />
      </Routes>
    </ToastProvider>
  );
}
