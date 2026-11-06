import { createContext, useContext, useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation, BrowserRouter } from 'react-router-dom';
import { api } from './api.js';
import { VaultProvider } from './hooks/useVault';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import ShareView from './pages/ShareView.jsx';
import Admin from './pages/Admin.jsx';
import VaultGate from './components/VaultGate.jsx';

const AuthContext = createContext({ user: null, loading: true, setUser: () => {} });
export const useAuth = () => useContext(AuthContext);

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const location = useLocation();

  useEffect(() => {
    api.me()
      .then((data) => setUser(data?.user ?? null))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  const auth = { user, loading, setUser };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-slate-100 dark:bg-[#0e1621]">
        <div className="flex flex-col items-center gap-3">
          <img src="/logo-icon.png" alt="TGStore" className="h-14 w-auto animate-pulse object-contain drop-shadow" />
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400">Loading TG<span className="text-sky-500 dark:text-sky-400">Store</span>…</p>
        </div>
      </div>
    );
  }

  return (
    <AuthContext.Provider value={auth}>
      <VaultProvider>
        <Routes>
          <Route
            path="/login"
            element={user ? <Navigate to="/app" replace /> : <Login />}
          />
          <Route
            path="/app/*"
            element={
              user ? (
                <VaultGate>
                  <Dashboard />
                </VaultGate>
              ) : (
                <Navigate to="/login" replace state={{ from: location }} />
              )
            }
          />
          <Route path="/s/:token" element={<ShareView />} />
          {/* Hidden admin dashboard — NO links/buttons anywhere; URL-only access.
              Security is enforced server-side by the x-admin-key header. */}
          <Route path="/admin" element={<Admin />} />
          <Route path="*" element={<Navigate to={user ? '/app' : '/login'} replace />} />
        </Routes>
      </VaultProvider>
    </AuthContext.Provider>
  );
}
