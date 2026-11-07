// Real identity on every request (Rule 2) — verifies the JWT, never trusts
// a client-supplied user/tenant id. Every route handler downstream reads
// `req.auth`, never a hard-coded constant (tenancy.ts is gone).
import type { Request, Response, NextFunction } from "express";
import { verifySession, type SessionClaims } from "./auth.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: SessionClaims;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.header("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
  const claims = token ? verifySession(token) : null;
  if (!claims) {
    res.status(401).json({ error: "Sign in required." });
    return;
  }
  req.auth = claims;
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.auth?.isAdmin) {
    res.status(403).json({ error: "Admin access required." });
    return;
  }
  next();
}
