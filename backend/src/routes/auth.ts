import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { signup, login, getUser } from "../services/users.js";
import { signSession } from "../auth.js";
import { requireAuth } from "../middleware.js";
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

const CredentialsSchema = z
  .object({
    email: z.string().email(),
    password: z.string().min(8, "Password must be at least 8 characters."),
  })
  .strict();

router.post("/api/auth/signup", async (req: Request, res: Response) => {
  const parsed = CredentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    return;
  }
  try {
    const user = await signup(parsed.data.email, parsed.data.password);
    const token = signSession({ userId: user.id, tenantId: user.tenantId, isAdmin: user.isAdmin });
    res.status(201).json({ token, user });
  } catch (err) {
    handleServiceError(err, res);
  }
});

router.post("/api/auth/login", async (req: Request, res: Response) => {
  const parsed = CredentialsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    return;
  }
  try {
    const user = await login(parsed.data.email, parsed.data.password);
    const token = signSession({ userId: user.id, tenantId: user.tenantId, isAdmin: user.isAdmin });
    res.json({ token, user });
  } catch (err) {
    handleServiceError(err, res);
  }
});

router.get("/api/auth/me", requireAuth, async (req: Request, res: Response) => {
  try {
    res.json(await getUser(req.auth!.userId));
  } catch (err) {
    handleServiceError(err, res);
  }
});
