import { Router, type Request, type Response } from "express";
import { buildPostmanCollection } from "../services/postman.js";
import { ServiceError } from "../services/registry.js";

export const router = Router();

router.get("/api/agents/:agentVersionId/postman", async (req: Request, res: Response) => {
  try {
    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const { filename, collection } = await buildPostmanCollection(req.params.agentVersionId, baseUrl);
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.json(collection);
  } catch (err) {
    if (err instanceof ServiceError) {
      res.status(err.status).json({ error: err.message });
      return;
    }
    console.error(err);
    res.status(500).json({ error: "Internal server error" });
  }
});
