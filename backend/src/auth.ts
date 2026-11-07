// Real login (Rule 2). Mirrors crypto.ts's shape: one small module, pure
// functions, the only place a password ever exists in plaintext (for the
// instant it's hashed or compared) or a session token is signed/verified.
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { config } from "./config.js";

const BCRYPT_COST = 12;
const TOKEN_TTL = "7d";

export interface SessionClaims {
  userId: string;
  tenantId: string;
  isAdmin: boolean;
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signSession(claims: SessionClaims): string {
  return jwt.sign(claims, config.JWT_SECRET, { expiresIn: TOKEN_TTL });
}

/** Returns null on any invalid/expired/tampered token — callers 401 rather than throw, a malformed Authorization header isn't a server error. */
export function verifySession(token: string): SessionClaims | null {
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    if (typeof decoded !== "object" || decoded === null) return null;
    const { userId, tenantId, isAdmin } = decoded as Record<string, unknown>;
    if (typeof userId !== "string" || typeof tenantId !== "string" || typeof isAdmin !== "boolean") return null;
    return { userId, tenantId, isAdmin };
  } catch {
    return null;
  }
}
