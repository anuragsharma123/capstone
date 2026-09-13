// Small hand-drawn line icons — no icon library, no emoji.

export function BrandMark() {
  return (
    <svg className="mark" viewBox="0 0 26 26" fill="none" aria-hidden="true">
      <circle cx="13" cy="5" r="3" fill="currentColor" />
      <circle cx="5" cy="20" r="3" fill="currentColor" />
      <circle cx="21" cy="20" r="3" fill="currentColor" />
      <path d="M13 8 L6.5 18 M13 8 L19.5 18 M8 20 H18" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

export function RegistryIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="14" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <rect x="3" y="12" width="14" height="5" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="6.2" cy="5.5" r=".9" fill="currentColor" />
      <circle cx="6.2" cy="14.5" r=".9" fill="currentColor" />
    </svg>
  );
}

export function ConnectionsIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <circle cx="5" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="15" cy="10" r="2.4" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7.4 10 H12.6" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function AgentsIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="6" height="6" rx="1.4" stroke="currentColor" strokeWidth="1.5" />
      <rect x="11" y="3" width="6" height="6" rx="1.4" stroke="currentColor" strokeWidth="1.5" />
      <rect x="3" y="11" width="6" height="6" rx="1.4" stroke="currentColor" strokeWidth="1.5" />
      <rect x="11" y="11" width="6" height="6" rx="1.4" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function BuildIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M4 16 L10 4 L16 16" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M6.6 11 H13.4" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function MarketplaceIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3 7 L4.5 3.5 H15.5 L17 7" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <rect x="3" y="7" width="14" height="9.5" rx="1.3" stroke="currentColor" strokeWidth="1.5" />
      <path d="M7.5 7 V10" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12.5 7 V10" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M8 3 V13 M3 8 H13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 4 L12 12 M12 4 L4 12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function ServersEmptyIcon() {
  return (
    <svg className="big" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="18" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
      <rect x="3" y="15" width="18" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function ToolsEmptyIcon() {
  return (
    <svg className="big" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M12 3 L20 7.5 V16.5 L12 21 L4 16.5 V7.5 Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M12 12 L20 7.5 M12 12 V21 M12 12 L4 7.5" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

export function ComingSoonIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.4" />
      <path d="M12 7 V12 L15.5 14" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}
