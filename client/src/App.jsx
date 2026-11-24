import React, { createContext, useContext, useEffect, useState } from 'react';
import { Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom';
import api from './api';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Products from './pages/Products';
import Inventory from './pages/Inventory';
import Sales from './pages/Sales';
import NewSale from './pages/NewSale';
import Purchases from './pages/Purchases';
import Customers from './pages/Customers';
import Suppliers from './pages/Suppliers';
import Expenses from './pages/Expenses';
import Reports from './pages/Reports';
import Financials from './pages/Financials';
import Closing from './pages/Closing';
import Settings from './pages/Settings';

const AuthCtx = createContext(null);
export const useAuth = () => useContext(AuthCtx);

const NAV = [
  { to: '/', label: 'Dashboard', icon: '▦', end: true },
  { to: '/sales/new', label: 'New Sale', icon: '＋' },
  { to: '/sales', label: 'Sales', icon: '🧾' },
  { to: '/products', label: 'Products', icon: '🍾' },
  { to: '/inventory', label: 'Inventory', icon: '📦' },
  { to: '/purchases', label: 'Purchases', icon: '🚚' },
  { to: '/customers', label: 'Customers', icon: '👥' },
  { to: '/suppliers', label: 'Suppliers', icon: '🏭' },
  { to: '/expenses', label: 'Expenses', icon: '💸' },
  { to: '/closing', label: 'Daily Closing', icon: '🔒' },
  { to: '/financials', label: 'Financials', icon: '📒' },
  { to: '/reports', label: 'Reports', icon: '📊' },
  { to: '/settings', label: 'Settings', icon: '⚙' },
];

function Layout({ children }) {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(true);
  return (
    <div className="flex min-h-screen">
      <aside className={`${open ? 'w-60' : 'w-16'} shrink-0 bg-white border-r border-navy-100 flex flex-col transition-all duration-200`}>
        <div className="flex items-center gap-2 px-4 py-5 border-b border-navy-100">
          <img src="/uploads/rv-logo.svg" alt="RV" className="h-9 w-9 shrink-0" />
          {open && <div>
            <div className="font-display font-bold text-gold-600 leading-tight">ROMARICK'S</div>
            <div className="text-[10px] tracking-[.3em] text-navy-600">VINTAGE</div>
          </div>}
        </div>
        <nav className="flex-1 py-3 space-y-0.5 px-2">
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} end={n.end}
              className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors ${isActive ? 'bg-gold-500 text-navy-900 font-semibold' : 'text-navy-700 hover:bg-gold-100'}`}>
              <span className="w-5 text-center">{n.icon}</span>
              {open && <span>{n.label}</span>}
            </NavLink>
          ))}
        </nav>
        <button onClick={() => setOpen(!open)} className="m-2 rounded-lg border border-navy-100 py-1.5 text-xs text-navy-600 hover:bg-gold-100">
          {open ? '◀ Collapse' : '▶'}
        </button>
      </aside>
      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-white border-b border-navy-100 px-6 py-3 flex items-center justify-between">
          <div className="text-sm text-navy-600">Premium Wholesale Drinks & Wine Management</div>
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-navy-800">{user?.name}</span>
            <button onClick={logout} className="btn-ghost text-xs">Sign out</button>
          </div>
        </header>
        <main className="flex-1 p-6 overflow-x-auto">{children}</main>
      </div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(undefined);
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/auth/me').then(r => setUser(r.data.user)).catch(() => setUser(null));
    const onExpired = () => setUser(null);
    window.addEventListener('auth:expired', onExpired);
    return () => window.removeEventListener('auth:expired', onExpired);
  }, []);

  useEffect(() => { if (user === null) navigate('/login'); }, [user]);

  const logout = async () => { await api.post('/auth/logout'); setUser(null); navigate('/login'); };

  if (user === undefined) return <div className="min-h-screen flex items-center justify-center text-navy-700">Loading…</div>;

  return (
    <AuthCtx.Provider value={{ user, setUser, logout }}>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" /> : <Login />} />
        {user ? (
          <Route path="/*" element={<Layout>
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/sales" element={<Sales />} />
              <Route path="/sales/new" element={<NewSale />} />
              <Route path="/products" element={<Products />} />
              <Route path="/inventory" element={<Inventory />} />
              <Route path="/purchases" element={<Purchases />} />
              <Route path="/customers" element={<Customers />} />
              <Route path="/suppliers" element={<Suppliers />} />
              <Route path="/closing" element={<Closing />} />
              <Route path="/financials" element={<Financials />} />
              <Route path="/expenses" element={<Expenses />} />
              <Route path="/reports" element={<Reports />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" />} />
            </Routes>
          </Layout>} />
        ) : <Route path="*" element={<Navigate to="/login" />} />}
      </Routes>
    </AuthCtx.Provider>
  );
}
