import { NavLink } from "react-router-dom";
import { RegistryIcon, ConnectionsIcon, AgentsIcon, BuildIcon, ReviewIcon, MarketplaceIcon } from "./icons";
import { useAuth } from "../contexts/AuthContext";

interface NavEntry {
  to: string;
  label: string;
  icon: () => JSX.Element;
  soon?: boolean;
  /** Hidden entirely for a non-admin — the backend gates this the same way (requireAdmin), so a non-admin seeing the link and hitting a 403 would just be confusing, not a real gate. */
  adminOnly?: boolean;
}

const NAV_ITEMS: NavEntry[] = [
  { to: "/registry", label: "MCP Registry", icon: RegistryIcon },
  { to: "/connections", label: "Connections", icon: ConnectionsIcon },
  { to: "/agents", label: "My Agents", icon: AgentsIcon },
  { to: "/build", label: "Build", icon: BuildIcon },
  { to: "/review", label: "Admin Review", icon: ReviewIcon, adminOnly: true },
  { to: "/marketplace", label: "Marketplace", icon: MarketplaceIcon },
];

export default function Sidebar() {
  const { user } = useAuth();

  return (
    <nav className="sidebar">
      {NAV_ITEMS.filter((item) => !item.adminOnly || user?.isAdmin).map(({ to, label, icon: Icon, soon }) => (
        <NavLink key={to} to={to} className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}>
          <Icon />
          <span className="label">{label}</span>
          {soon && <span className="soon">Soon</span>}
        </NavLink>
      ))}
    </nav>
  );
}
