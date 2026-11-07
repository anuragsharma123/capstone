import { BrowserRouter, Routes, Route, Navigate, Outlet } from "react-router-dom";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import AppShell from "./components/AppShell";
import LoginPage from "./pages/LoginPage";
import SignupPage from "./pages/SignupPage";
import McpRegistryPage from "./pages/McpRegistryPage";
import ConnectionsPage from "./pages/ConnectionsPage";
import BuildPage from "./pages/BuildPage";
import AgentsPage from "./pages/AgentsPage";
import AgentDetailPage from "./pages/AgentDetailPage";
import AdminReviewPage from "./pages/AdminReviewPage";
import MarketplacePage from "./pages/MarketplacePage";
import MarketplaceDetailPage from "./pages/MarketplaceDetailPage";

/** Gates every route inside AppShell — a real session is required to reach any of them, not just a UI nicety (the backend enforces the same thing per-request; this just avoids flashing a page that would 401 anyway). */
function RequireAuth() {
  const { user, loading } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/signup" element={<SignupPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<AppShell />}>
              <Route index element={<Navigate to="/registry" replace />} />
              <Route path="/registry" element={<McpRegistryPage />} />
              <Route path="/connections" element={<ConnectionsPage />} />
              <Route path="/agents" element={<AgentsPage />} />
              <Route path="/agents/:agentId" element={<AgentDetailPage />} />
              <Route path="/build" element={<BuildPage />} />
              <Route path="/review" element={<AdminReviewPage />} />
              <Route path="/marketplace" element={<MarketplacePage />} />
              <Route path="/marketplace/:listingId" element={<MarketplaceDetailPage />} />
              <Route path="*" element={<Navigate to="/registry" replace />} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
