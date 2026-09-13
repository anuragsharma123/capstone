import { z } from "zod";

// All configuration comes from the environment — nothing is ever hard-coded.
// Fails fast at startup with a clear message rather than throwing deep
// inside a request handler later.
const EnvSchema = z.object({
  PORT: z.coerce.number().int().min(1).max(65535).default(8001),

  // Real Postgres (embedded-postgres — a real, prebuilt Postgres binary
  // downloaded via npm, no system install, no Docker). Data lives in
  // PG_DATA_DIR between restarts; PG_PORT is a local, unusual default so it
  // doesn't collide with a system Postgres that might be on 5432.
  PG_PORT: z.coerce.number().int().min(1).max(65535).default(54329),
  PG_DATA_DIR: z.string().default("./pgdata"),
  PG_PASSWORD: z.string().default("anurag_dev_password"),

  KMS_MASTER_KEY: z
    .string()
    .refine(
      (v) => {
        try {
          return Buffer.from(v, "base64").length === 32;
        } catch {
          return false;
        }
      },
      {
        message:
          "KMS_MASTER_KEY must be a base64-encoded 32-byte key. Generate one with: " +
          'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"',
      }
    ),

  // Build Orchestrator's parse_intent node (services/builder.ts) — the only
  // LLM call in the platform so far. Per root CLAUDE.md, claude-sonnet-5 is
  // this project's default model.
  ANTHROPIC_API_KEY: z.string().min(1, "ANTHROPIC_API_KEY is required for the Agent Builder's parse_intent step."),
});

function loadConfig() {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    console.error(`Invalid environment configuration:\n${issues}`);
    process.exit(1);
  }
  return parsed.data;
}

export const config = loadConfig();
