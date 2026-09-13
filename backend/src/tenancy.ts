// There's no auth system yet — every row is scoped to one hard-coded
// owner/tenant so the schema already matches the documented shape
// (owner_id + tenant_id on every user-owned table, data-model.html §6)
// without requiring a login flow to exist first.
//
// Swapping in real auth later means changing what populates these two
// values per request (e.g. from a verified JWT) — nothing about the
// schema, the queries, or the encryption path needs to change.
export const DEFAULT_OWNER_ID = "local-user";
export const DEFAULT_TENANT_ID = "local-tenant";
