import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listServers, removeConnection, ApiError } from "../lib/api";
import { formatShortDate, formatRelativeTime } from "../lib/format";
import { ConnectionsIcon } from "../components/icons";

const SERVERS_KEY = ["servers"] as const;

/** Read-mostly view of every server that currently has a credential on file — across the whole registry. */
export default function ConnectionsPage() {
  const queryClient = useQueryClient();
  const serversQuery = useQuery({ queryKey: SERVERS_KEY, queryFn: listServers });

  const disconnectMutation = useMutation({
    mutationFn: (id: string) => removeConnection(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SERVERS_KEY }),
  });

  const connections = (serversQuery.data ?? []).filter((s) => s.connected);

  return (
    <>
      <div className="page-head">
        <h2>Connections</h2>
        <p>Every server you've added a credential for. Disconnecting removes the stored credential, not the server itself.</p>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h3>Active Connections</h3>
          <span className="count">{connections.length}</span>
        </div>
        <div className="panel-body">
          {serversQuery.isLoading ? (
            <div className="empty-state">Loading…</div>
          ) : serversQuery.isError ? (
            <div className="empty-state">
              {serversQuery.error instanceof ApiError ? serversQuery.error.message : "Couldn't load connections."}
            </div>
          ) : connections.length === 0 ? (
            <div className="empty-state">
              <ConnectionsIcon />
              No active connections yet — add a credential from a server's card on the MCP Registry page.
            </div>
          ) : (
            <table className="connections-table">
              <thead>
                <tr>
                  <th>Server</th>
                  <th>Status</th>
                  <th>Secret</th>
                  <th>Added</th>
                  <th>Last used</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {connections.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div className="name" title={s.address}>
                        {s.name}
                      </div>
                      {s.status === "dead" && <span className="vis-badge dead">Unreachable</span>}
                    </td>
                    <td>
                      <span className={`status-chip ${s.connectionStatus ?? "active"}`}>
                        {s.connectionStatus ?? "active"}
                      </span>
                    </td>
                    <td className="secret-cell">••••••••••••</td>
                    <td className="muted-cell">{s.connectedAt ? formatShortDate(s.connectedAt) : "—"}</td>
                    <td className="muted-cell">{s.lastUsedAt ? formatRelativeTime(s.lastUsedAt) : "Never"}</td>
                    <td>
                      <button
                        type="button"
                        className="connect-link danger"
                        onClick={() => disconnectMutation.mutate(s.id)}
                        disabled={disconnectMutation.isPending}
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </>
  );
}
