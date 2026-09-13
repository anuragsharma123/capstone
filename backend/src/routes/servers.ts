import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { registerServer, listServers, deleteServer, addConnection, removeConnection, ServiceError } from "../services/registry.js";
import { AuthSpecSchema } from "../authSpec.js";
import { TransportSchema } from "../transport.js";

export const router = Router();

const ServerCreateSchema = z
  .object({
    name: z.string().min(1),
    transport: TransportSchema.default("streamable_http"),
    address: z.string().min(1),
    visibility: z.enum(["open", "private"]).default("open"),
    // Shape only, never a value stored from this — registration is discovery-only.
    authSpec: AuthSpecSchema.optional(),
    // Used ONLY to authenticate the discovery call itself, for a server
    // that demands auth just to answer tools/list. Never persisted —
    // storing a credential is still exclusively the Connect step's job.
    discoveryValues: z.record(z.string()).optional(),
  })
  .strict();

const ConnectionCreateSchema = z.object({ values: z.record(z.string().min(1)) }).strict();

function handleServiceError(err: unknown, res: Response): void {
  if (err instanceof ServiceError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
}

router.post("/api/servers", async (req: Request, res: Response) => {
  const parsed = ServerCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    return;
  }
  try {
    const server = await registerServer(parsed.data);
    res.status(201).json(server);
  } catch (err) {
    handleServiceError(err, res);
  }
});

router.get("/api/servers", async (_req: Request, res: Response) => {
  try {
    res.json(await listServers());
  } catch (err) {
    handleServiceError(err, res);
  }
});

router.delete("/api/servers/:id", async (req: Request, res: Response) => {
  try {
    await deleteServer(req.params.id);
    res.status(204).end();
  } catch (err) {
    handleServiceError(err, res);
  }
});

router.post("/api/servers/:id/connection", async (req: Request, res: Response) => {
  const parsed = ConnectionCreateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    return;
  }
  try {
    const server = await addConnection(req.params.id, parsed.data.values);
    res.json(server);
  } catch (err) {
    handleServiceError(err, res);
  }
});

router.delete("/api/servers/:id/connection", async (req: Request, res: Response) => {
  try {
    const server = await removeConnection(req.params.id);
    res.json(server);
  } catch (err) {
    handleServiceError(err, res);
  }
});
