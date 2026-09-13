import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { publishAgentVersion } from "../services/publish.js";
import { listReviewSubmissions, decideReviewSubmission, listMarketplace } from "../services/review.js";
import { ServiceError } from "../services/registry.js";

export const router = Router();

function handleServiceError(err: unknown, res: Response): void {
  if (err instanceof ServiceError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Internal server error" });
}

router.post("/api/agents/:agentVersionId/publish", async (req: Request, res: Response) => {
  try {
    const result = await publishAgentVersion(req.params.agentVersionId);
    res.status(201).json(result);
  } catch (err) {
    handleServiceError(err, res);
  }
});

router.get("/api/review-submissions", async (req: Request, res: Response) => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    res.json(await listReviewSubmissions(status));
  } catch (err) {
    handleServiceError(err, res);
  }
});

const DecideSchema = z
  .object({
    decision: z.enum(["approved", "changes_requested", "rejected"]),
    notes: z.string().optional(),
  })
  .strict();

router.post("/api/review-submissions/:id/decide", async (req: Request, res: Response) => {
  const parsed = DecideSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    return;
  }
  try {
    const result = await decideReviewSubmission(req.params.id, parsed.data.decision, parsed.data.notes);
    res.json(result);
  } catch (err) {
    handleServiceError(err, res);
  }
});

router.get("/api/marketplace", async (_req: Request, res: Response) => {
  try {
    res.json(await listMarketplace());
  } catch (err) {
    handleServiceError(err, res);
  }
});
