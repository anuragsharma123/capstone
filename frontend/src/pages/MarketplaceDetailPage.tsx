import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import { getMarketplaceListing, installFromMarketplace, ApiError } from "../lib/api";
import { formatRelativeTime, scoreGrade, graphLabel } from "../lib/format";

/**
 * One marketplace listing's own page — reached only from a Marketplace
 * card, never from an owner's `/agents/:id`. Built entirely from the same
 * sanitized manifest the list already uses (services/sanitizer.ts); there
 * is no richer query this page could reach for even by mistake — the
 * `marketplace` table only ever stores the sanitized version. "Add to my
 * workspace" lives here instead of on the list card.
 */
export default function MarketplaceDetailPage() {
  const { listingId } = useParams<{ listingId: string }>();
  const navigate = useNavigate();
  const listingQuery = useQuery({
    queryKey: ["marketplace", listingId],
    queryFn: () => getMarketplaceListing(listingId!),
    enabled: Boolean(listingId),
  });

  const installMutation = useMutation({
    mutationFn: () => installFromMarketplace(listingId!),
    onSuccess: (result) => navigate(`/agents/${result.agentId}`),
  });

  if (listingQuery.isLoading) return <div className="empty-state">Loading…</div>;
  if (listingQuery.isError) {
    return <div className="empty-state">{listingQuery.error instanceof ApiError ? listingQuery.error.message : "Couldn't load this listing."}</div>;
  }
  const listing = listingQuery.data;
  if (!listing) return null;
  const m = listing.sanitizedManifest;

  return (
    <>
      <div className="page-head">
        <Link to="/marketplace" className="connect-link">
          ← Marketplace
        </Link>
      </div>

      <div className="agent-card">
        <div className="agent-card-head">
          <div className="agent-card-name">{m.name}</div>
          <span className="status-chip published">live</span>
        </div>
        <p className="agent-description">{m.description}</p>

        <dl className="agent-card-facts">
          <div className="agent-fact">
            <dt>Shape</dt>
            <dd>{graphLabel(m.graphType)}</dd>
          </div>
          <div className="agent-fact">
            <dt>Model</dt>
            <dd>{m.model}</dd>
          </div>
          <div className="agent-fact">
            <dt>Access</dt>
            <dd className="agent-fact-tools">
              {m.capabilities.length === 0 ? (
                <span className="tag-chip">reasoning only</span>
              ) : (
                m.capabilities.map((c) => (
                  <span className={`sev-chip ${c.sensitivity}`} key={c.toolName}>
                    {c.toolName}
                  </span>
                ))
              )}
            </dd>
          </div>
          <div className="agent-fact">
            <dt>Score</dt>
            <dd>
              {listing.effectivenessScore}/100 <span className="vis-badge">{scoreGrade(listing.effectivenessScore)}</span> · Safety{" "}
              {listing.safetyScore}/100
            </dd>
          </div>
          <div className="agent-fact">
            <dt>Published</dt>
            <dd>{formatRelativeTime(listing.publishedAt)}</dd>
          </div>
        </dl>
      </div>

      <section className="panel" style={{ marginTop: 20 }}>
        <div className="panel-head">
          <h3>Add to my workspace</h3>
        </div>
        <div className="panel-body">
          <p className="agent-description">
            Copies this agent's real configuration into your own workspace as a new, independent agent — editable and runnable on its own,
            never touching the original.
          </p>
          <button type="button" className="primary" onClick={() => installMutation.mutate()} disabled={installMutation.isPending}>
            {installMutation.isPending ? "Adding…" : "Add to my workspace"}
          </button>
          {installMutation.isError && (
            <p className="connect-error" style={{ marginTop: 8 }}>
              {installMutation.error instanceof ApiError ? installMutation.error.message : "Couldn't install this agent."}
            </p>
          )}
        </div>
      </section>
    </>
  );
}
