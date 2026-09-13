import { NavLink } from "react-router-dom";
import { RegistryIcon, ConnectionsIcon, AgentsIcon, BuildIcon, MarketplaceIcon } from "./icons";

interface NavEntry {
  to: string;
  label: string;
  icon: () => JSX.Element;
  soon?: boolean;
}

const NAV_ITEMS: NavEntry[] = [
  { to: "/registry", label: "MCP Registry", icon: RegistryIcon },
  { to: "/connections", label: "Connections", icon: ConnectionsIcon },
  { to: "/agents", label: "My Agents", icon: AgentsIcon, soon: true },
  { to: "/build", label: "Build", icon: BuildIcon },
  { to: "/marketplace", label: "Marketplace", icon: MarketplaceIcon, soon: true },
];

export default function Sidebar() {
  return (
    <nav className="sidebar">
      {NAV_ITEMS.map(({ to, label, icon: Icon, soon }) => (
        <NavLink key={to} to={to} className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}>
          <Icon />
          <span className="label">{label}</span>
          {soon && <span className="soon">Soon</span>}
        </NavLink>
      ))}
    </nav>
  );
}
