// MCP transports a server can be registered under. Only `streamable_http`
// is actually wired up (mcpClient.ts) — `sse` and `stdio` are named here so
// the Register form can be honest about what MCP supports, while
// registerServer() rejects them outright instead of quietly attempting (and
// failing) an HTTP call against a server that isn't one.
import { z } from "zod";

export const TransportSchema = z.enum(["streamable_http", "sse", "stdio"]);
export type Transport = z.infer<typeof TransportSchema>;

export const IMPLEMENTED_TRANSPORTS: readonly Transport[] = ["streamable_http"];
