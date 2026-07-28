import { useState } from 'react';
import { Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar.jsx';
import Header from '../components/Header.jsx';
import './MainLayout.css';

/**
 * The authenticated application shell: a collapsible sidebar plus a scrollable
 * content region rendered via <Outlet />. The header only appears on mobile,
 * where the sidebar is an off-screen drawer.
 */
export default function MainLayout() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className={`app-shell ${collapsed ? 'app-shell--collapsed' : ''}`}>
      <Sidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        onCloseMobile={() => setMobileOpen(false)}
        onToggleCollapse={() => setCollapsed((c) => !c)}
      />
      <Header onToggleMobile={() => setMobileOpen((o) => !o)} />
      <main className="app-content">
        <Outlet />
      </main>
    </div>
  );
}
