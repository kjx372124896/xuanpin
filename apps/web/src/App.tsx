import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { Spin } from "antd";
import { useAuth } from "./auth/AuthContext";
import { AppLayout } from "./components/AppLayout";
import { LoginPage } from "./pages/LoginPage";
import { ProductsPage } from "./pages/ProductsPage";

const AdminPage = lazy(() => import("./pages/AdminPage").then((module) => ({ default: module.AdminPage })));
const ImportPage = lazy(() => import("./pages/ImportPage").then((module) => ({ default: module.ImportPage })));
const DmpAuthPage = lazy(() => import("./pages/DmpAuthPage").then((module) => ({ default: module.DmpAuthPage })));

function RequireAuth() {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading-screen"><Spin size="large" /></div>;
  return user ? <Outlet /> : <Navigate to="/login" replace />;
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (!user || (user.role !== "ADMIN" && user.role !== "SUPER_ADMIN")) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function RequireImporter() {
  const { user } = useAuth();
  if (user?.role === "EMPLOYEE" && !user.canImport) return <Navigate to="/" replace />;
  return <ImportPage />;
}

export function App() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppLayout />}>
          <Route index element={<ProductsPage />} />
          <Route path="dmp-auth" element={<RequireAdmin><Suspense fallback={<div className="loading-screen"><Spin /></div>}><DmpAuthPage /></Suspense></RequireAdmin>} />
          <Route path="imports" element={<Suspense fallback={<div className="loading-screen"><Spin /></div>}><RequireImporter /></Suspense>} />
          <Route path="admin" element={<RequireAdmin><Suspense fallback={<div className="loading-screen"><Spin /></div>}><AdminPage /></Suspense></RequireAdmin>} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to={user ? "/" : "/login"} replace />} />
    </Routes>
  );
}
