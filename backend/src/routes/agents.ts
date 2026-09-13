import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { startAgentBuild, resumeAgentBuild } from "../services/builder.js";
import { ServiceError } from "../services/registry.js";

export const router = Router();

const BuildRequestSchema = z.object({ prompt: z.string().min(1) }).strict();

// Which fields are required depends on the thread's current interrupt_kind —
// checked in services/builder.ts, not here, since that check needs the DB.
const ResumeRequestSchema = z
  .object({
    confirmedTools: z.array(z.object({ mcpServerId: z.string().min(1), toolName: z.string().min(1) })).optional(),
    credentials: z.array(z.object({ mcpServerId: z.string().min(1), values: z.record(z.string().min(1)) })).optional(),
  })
  .strict();

function handleServiceError(err: unknown, res: Response): void {
  if (err instanceof ServiceError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
}

router.post("/api/agents/build", async (req: Request, res: Response) => {
  const parsed = BuildRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    return;
  }
  try {
    const result = await startAgentBuild(parsed.data.prompt);
    res.status(200).json(result);
  } catch (err) {
    handleServiceError(err, res);
  }
});

router.post("/api/agents/build/:threadId/resume", async (req: Request, res: Response) => {
  const parsed = ResumeRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    return;
  }
  try {
    const result = await resumeAgentBuild(req.params.threadId, parsed.data);
    res.status(result.status === "completed" ? 201 : 200).json(result);
  } catch (err) {
    handleServiceError(err, res);
  }
});
