import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { publishAgentVersion } from "../services/publish.js";
import { listReviewSubmissions, decideReviewSubmission, listMarketplace, getMarketplaceListing } from "../services/review.js";
import { installFromMarketplace } from "../services/install.js";
import { ServiceError } from "../services/registry.js";
import { requireAuth, requireAdmin } from "../middleware.js";

export const router = Router();
// Marketplace requires login too (DESIGN-NOTES §2.9: "cross-tenant" ≠ "open") —
// applied to the whole file, admin-only routes layer requireAdmin on top.
router.use(requireAuth);

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
    const result = await publishAgentVersion(req.auth!, req.params.agentVersionId);
    res.status(201).json(result);
  } catch (err) {
    handleServiceError(err, res);
  }
});

router.get("/api/review-submissions", requireAdmin, async (req: Request, res: Response) => {
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

router.post("/api/review-submissions/:id/decide", requireAdmin, async (req: Request, res: Response) => {
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

router.get("/api/marketplace/:id", async (req: Request, res: Response) => {
  try {
    res.json(await getMarketplaceListing(req.params.id));
  } catch (err) {
    handleServiceError(err, res);
  }
});

router.post("/api/marketplace/:id/install", async (req: Request, res: Response) => {
  try {
    const result = await installFromMarketplace(req.auth!, req.params.id);
    res.status(201).json(result);
  } catch (err) {
    handleServiceError(err, res);
  }
});
