import { useQuery } from "@tanstack/react-query";
import { listMarketplace, ApiError } from "../lib/api";
import { formatRelativeTime, graphLabel } from "../lib/format";
import { MarketplaceIcon } from "../components/icons";
import AgentGridCard, { type AgentGridTag } from "../components/AgentGridCard";

/**
 * Every approved, published agent — nothing lands here except through
 * Admin Review's 'approved' decision (services/review.ts); there's no other
 * write path into the marketplace table. What's rendered is always the
 * *sanitized* manifest (services/sanitizer.ts) — what an agent does and
 * what kinds of access it needs, never mcp_server_id, never a system_prompt,
 * never a credential (verified live: grepped a real response for
 * secret/token/ciphertext/mcp_server_id/system_prompt — none present).
 *
 * Cards link to `/marketplace/:id` — the listing's own page, never to the
 * owner's private `/agents/:id`. Linking through to the real agent would
 * defeat the point of sanitizing this screen in the first place (Rule 2/5);
 * "Add to my workspace" lives on that detail page instead of inline here.
 */
export default function MarketplacePage() {
  const marketplaceQuery = useQuery({ queryKey: ["marketplace"], queryFn: listMarketplace });
  const listings = marketplaceQuery.data ?? [];

  return (
    <>
      <div className="page-head">
        <h2>Marketplace</h2>
        <p>
          Every listing here was approved by an admin — nothing reaches this page automatically. Each one carries an agent's design (what it
          does, what kinds of access it needs) and never credentials or anything internal to whoever built it.
        </p>
      </div>

      {marketplaceQuery.isLoading ? (
        <div className="empty-state">Loading…</div>
      ) : marketplaceQuery.isError ? (
        <div className="empty-state">{marketplaceQuery.error instanceof ApiError ? marketplaceQuery.error.message : "Couldn't load the marketplace."}</div>
      ) : listings.length === 0 ? (
        <div className="empty-state">
          <MarketplaceIcon />
          Nothing published yet — approve a submission in Admin Review to see it here.
        </div>
      ) : (
        <div className="agent-grid">
          {listings.map((l) => {
            const m = l.sanitizedManifest;
            const tags: AgentGridTag[] = [
              { key: "model", label: m.model },
              { key: "shape", label: graphLabel(m.graphType) },
              ...m.capabilities.map((c) => ({ key: c.toolName, label: c.toolName, variant: c.sensitivity as AgentGridTag["variant"] })),
            ];
            return (
              <AgentGridCard
                key={l.id}
                href={`/marketplace/${l.id}`}
                name={m.name}
                status="published"
                statusLabel="live"
                description={m.description}
                tags={tags}
                effectivenessScore={l.effectivenessScore}
                safetyScore={l.safetyScore}
                meta={`published ${formatRelativeTime(l.publishedAt)}`}
              />
            );
          })}
        </div>
      )}
    </>
  );
}
