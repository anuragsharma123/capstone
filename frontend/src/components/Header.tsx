import { BrandMark } from "./icons";
import { useAuth } from "../contexts/AuthContext";

export default function Header() {
  const { user, logout } = useAuth();

  return (
    <header className="topbar">
      <div className="brand">
        <BrandMark />
        <h1>Agent Builder Platform</h1>
      </div>
      <div className="topbar-right">
        {user && (
          <>
            <span className="tenant-chip">
              <span className="dot" />
              {user.email}
              {user.isAdmin && " · admin"}
            </span>
            <button type="button" className="logout-link" onClick={logout}>
              Sign out
            </button>
          </>
        )}
      </div>
    </header>
  );
}
