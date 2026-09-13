import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import ServerCard from "../components/ServerCard";
import AddServerForm, { type AddServerValues, type FormStatus } from "../components/AddServerForm";
import { ServersEmptyIcon } from "../components/icons";
import { listServers, registerServer, deleteServer, addConnection, removeConnection, normalizeAddress, ApiError } from "../lib/api";

const SERVERS_KEY = ["servers"] as const;

export default function McpRegistryPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<FormStatus | null>(null);
  const [resetToken, setResetToken] = useState(0);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [connectError, setConnectError] = useState<{ id: string; message: string } | null>(null);

  const serversQuery = useQuery({ queryKey: SERVERS_KEY, queryFn: listServers });

  const registerMutation = useMutation({
    mutationFn: (values: AddServerValues) =>
      registerServer({
        name: values.name,
        transport: values.transport,
        address: normalizeAddress(values.address),
        visibility: values.visibility,
        authSpec: values.authSpec ?? undefined,
        discoveryValues: values.authSpec ? values.discoveryValues : undefined,
      }),
    onMutate: () => setStatus({ kind: "loading", message: "Connecting…" }),
    onSuccess: (server) => {
      queryClient.invalidateQueries({ queryKey: SERVERS_KEY });
      setStatus({
        kind: "success",
        message: `Added "${server.name}" — pulled ${server.tools.length} tool${server.tools.length === 1 ? "" : "s"}.`,
      });
      setResetToken((n) => n + 1);
    },
    onError: (err) => {
      setStatus({ kind: "error", message: err instanceof ApiError ? err.message : "Something went wrong." });
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => deleteServer(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SERVERS_KEY }),
  });

  const connectMutation = useMutation({
    mutationFn: ({ id, values }: { id: string; values: Record<string, string> }) => addConnection(id, values),
    onMutate: ({ id }) => {
      setConnectingId(id);
      setConnectError(null);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SERVERS_KEY }),
    onError: (err, { id }) => {
      setConnectError({ id, message: err instanceof ApiError ? err.message : "Something went wrong." });
    },
    onSettled: () => setConnectingId(null),
  });

  const disconnectMutation = useMutation({
    mutationFn: (id: string) => removeConnection(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SERVERS_KEY }),
  });

  const servers = serversQuery.data ?? [];

  return (
    <>
      <div className="page-head">
        <h2>MCP Registry</h2>
        <p>
          Register a server once — its tools become available to every agent you build. Add a server below and
          its actions are pulled automatically and listed right on its card.
        </p>
      </div>

      <section className="panel">
        <div className="panel-head">
          <h3>Registered Servers</h3>
          <span className="count">{servers.length}</span>
        </div>
        <div className="panel-body">
          {serversQuery.isLoading ? (
            <div className="empty-state">Loading…</div>
          ) : serversQuery.isError ? (
            <div className="empty-state">
              {serversQuery.error instanceof ApiError
                ? serversQuery.error.message
                : "Couldn't load the registry."}
            </div>
          ) : servers.length === 0 ? (
            <div className="empty-state">
              <ServersEmptyIcon />
              No servers registered yet — add one below.
            </div>
          ) : (
            <div className="servers-grid">
              {servers.map((s) => (
                <ServerCard
                  key={s.id}
                  server={s}
                  onRemove={(id) => removeMutation.mutate(id)}
                  onConnect={(id, values) => connectMutation.mutate({ id, values })}
                  onDisconnect={(id) => disconnectMutation.mutate(id)}
                  connecting={connectMutation.isPending && connectingId === s.id}
                  connectError={connectError?.id === s.id ? connectError.message : null}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="panel form-panel">
        <div className="panel-head">
          <h3>Add an MCP Server</h3>
        </div>
        <div className="panel-body">
          <AddServerForm
            key={resetToken}
            pending={registerMutation.isPending}
            status={status}
            onSubmit={(values) => registerMutation.mutate(values)}
          />
        </div>
      </section>
    </>
  );
}
