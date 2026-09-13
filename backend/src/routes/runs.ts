import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { startAgentRun, resumeAgentRun, listPendingApprovals, getRunDetail } from "../services/runner.js";
import { ServiceError } from "../services/registry.js";

export const router = Router();

const StartRunSchema = z.object({ message: z.string().min(1) }).strict();

const DecisionSchema = z.union([
  z.object({ type: z.literal("approve") }).strict(),
  z.object({ type: z.literal("reject"), message: z.string().optional() }).strict(),
]);
const ResumeRunSchema = z.object({ decisions: z.array(DecisionSchema).min(1) }).strict();

function handleServiceError(err: unknown, res: Response): void {
  if (err instanceof ServiceError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
}

router.post("/api/agents/:agentVersionId/run", async (req: Request, res: Response) => {
  const parsed = StartRunSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    return;
  }
  try {
    const result = await startAgentRun(req.params.agentVersionId, parsed.data.message);
    res.status(result.status === "completed" ? 200 : 202).json(result);
  } catch (err) {
    handleServiceError(err, res);
  }
});

router.get("/api/agents/runs/pending", async (_req: Request, res: Response) => {
  try {
    res.json(await listPendingApprovals());
  } catch (err) {
    handleServiceError(err, res);
  }
});

router.get("/api/agents/runs/:threadId", async (req: Request, res: Response) => {
  try {
    res.json(await getRunDetail(req.params.threadId));
  } catch (err) {
    handleServiceError(err, res);
  }
});

router.post("/api/agents/runs/:threadId/resume", async (req: Request, res: Response) => {
  const parsed = ResumeRunSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    return;
  }
  try {
    const result = await resumeAgentRun(req.params.threadId, parsed.data.decisions);
    res.status(result.status === "completed" ? 200 : 202).json(result);
  } catch (err) {
    handleServiceError(err, res);
  }
});
