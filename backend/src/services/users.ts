// Signup/login. Runs before any session exists, so — unlike every other
// service in this app — it talks to the plain pool directly, never
// withTenant() (there's no auth to scope by yet; that's what this module
// produces). 1 user = 1 tenant (confirmed scope): signup creates both rows
// together. The very first account ever created becomes is_admin — the
// simplest real bootstrap for "a queue only admins can open" (Admin
// Review) that doesn't need a manual DB edit.
import { randomUUID } from "node:crypto";
import { getPool } from "../db.js";
import { hashPassword, verifyPassword } from "../auth.js";
import { ServiceError } from "./registry.js";

export interface AuthUser {
  id: string;
  tenantId: string;
  email: string;
  isAdmin: boolean;
}

function toAuthUser(row: { id: string; tenant_id: string; email: string; is_admin: boolean }): AuthUser {
  return { id: row.id, tenantId: row.tenant_id, email: row.email, isAdmin: row.is_admin };
}

export async function signup(email: string, password: string): Promise<AuthUser> {
  const pool = getPool();
  const normalizedEmail = email.trim().toLowerCase();

  const { rows: existing } = await pool.query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);
  if (existing[0]) throw new ServiceError(409, "An account with that email already exists.");

  const { rows: countRows } = await pool.query<{ count: string }>("SELECT COUNT(*) AS count FROM users");
  const isFirstUser = countRows[0].count === "0";

  const tenantId = randomUUID();
  const userId = randomUUID();
  const passwordHash = await hashPassword(password);

  await pool.query("INSERT INTO tenants (id, name) VALUES ($1, $2)", [tenantId, `${normalizedEmail}'s workspace`]);
  await pool.query("INSERT INTO users (id, tenant_id, email, password_hash, is_admin) VALUES ($1, $2, $3, $4, $5)", [
    userId,
    tenantId,
    normalizedEmail,
    passwordHash,
    isFirstUser,
  ]);

  return { id: userId, tenantId, email: normalizedEmail, isAdmin: isFirstUser };
}

export async function login(email: string, password: string): Promise<AuthUser> {
  const pool = getPool();
  const { rows } = await pool.query<{ id: string; tenant_id: string; email: string; password_hash: string; is_admin: boolean }>(
    "SELECT id, tenant_id, email, password_hash, is_admin FROM users WHERE email = $1",
    [email.trim().toLowerCase()]
  );
  const row = rows[0];
  // Same "invalid credentials" message whether the email doesn't exist or
  // the password is wrong — distinguishing the two would let a caller
  // enumerate real accounts.
  if (!row || !(await verifyPassword(password, row.password_hash))) {
    throw new ServiceError(401, "Invalid email or password.");
  }
  return toAuthUser(row);
}

export async function getUser(id: string): Promise<AuthUser> {
  const pool = getPool();
  const { rows } = await pool.query<{ id: string; tenant_id: string; email: string; is_admin: boolean }>(
    "SELECT id, tenant_id, email, is_admin FROM users WHERE id = $1",
    [id]
  );
  if (!rows[0]) throw new ServiceError(404, "User not found.");
  return toAuthUser(rows[0]);
}
