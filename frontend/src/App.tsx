import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import AppShell from "./components/AppShell";
import McpRegistryPage from "./pages/McpRegistryPage";
import ConnectionsPage from "./pages/ConnectionsPage";
import BuildPage from "./pages/BuildPage";
import AgentsPage from "./pages/AgentsPage";
import AgentDetailPage from "./pages/AgentDetailPage";
import AdminReviewPage from "./pages/AdminReviewPage";
import ComingSoonPage from "./pages/ComingSoonPage";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/registry" replace />} />
          <Route path="/registry" element={<McpRegistryPage />} />
          <Route path="/connections" element={<ConnectionsPage />} />
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/agents/:agentId" element={<AgentDetailPage />} />
          <Route path="/build" element={<BuildPage />} />
          <Route path="/review" element={<AdminReviewPage />} />
          <Route path="/marketplace" element={<ComingSoonPage title="Marketplace" />} />
          <Route path="*" element={<Navigate to="/registry" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
