// Pure display-formatting helpers — no React here (per the project's coding rules).

/** "12 Aug" */
export function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { day: "2-digit", month: "short" });
}

/** "2h ago" / "31m ago" / "4d ago" — coarsest unit that's still >= 1. */
export function formatRelativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
