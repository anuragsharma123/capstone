import { BrandMark } from "./icons";

export default function Header() {
  return (
    <header className="topbar">
      <div className="brand">
        <BrandMark />
        <h1>Agent Builder Platform</h1>
      </div>
      <div className="topbar-right">
        <span className="tenant-chip">
          <span className="dot" />
          Your workspace
        </span>
      </div>
    </header>
  );
}
