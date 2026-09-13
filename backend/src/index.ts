import express from "express";
import { config } from "./config.js";
import { connectDatabase } from "./db.js";
import { router as serversRouter } from "./routes/servers.js";
import { router as agentsRouter } from "./routes/agents.js";
import { router as runsRouter } from "./routes/runs.js";
import { router as publishRouter } from "./routes/publish.js";
import { router as webhooksRouter } from "./routes/webhooks.js";
import { startHealthChecker } from "./health.js";
import { setupCheckpointer } from "./checkpointer.js";

async function main(): Promise<void> {
  // Starts the embedded Postgres cluster (or resumes the existing one in
  // PG_DATA_DIR), connects, and ensures the schema exists — before anything
  // else runs.
  await connectDatabase();
  await setupCheckpointer();
  startHealthChecker();

  const app = express();

  // Local dev tool, not internet-facing — permissive CORS so AnuragFrontend
  // (a different origin/port) can call this directly, same rationale as
  // WorkingServer's own CORS middleware.
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type, Accept");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  // Capture the raw bytes alongside the parsed body — webhook signature
  // verification (routes/webhooks.ts) must HMAC the exact bytes the sender
  // signed, not a re-serialization of the parsed JSON (which can differ in
  // whitespace/key order and would make every signature check fail).
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    })
  );
  app.use(serversRouter);
  app.use(agentsRouter);
  app.use(runsRouter);
  app.use(publishRouter);
  app.use(webhooksRouter);

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });

  const httpServer = app.listen(config.PORT, () => {
    console.error(`anurag-backend listening on http://localhost:${config.PORT}`);
    console.error(`  POST   /api/servers                register a server (discovery + classification)`);
    console.error(`  GET    /api/servers                 list registered servers + their tools`);
    console.error(`  DELETE /api/servers/:id              remove a server`);
    console.error(`  POST   /api/servers/:id/connection   add/replace a credential (reactive auth)`);
    console.error(`  DELETE /api/servers/:id/connection   remove a stored credential`);
    console.error(`  POST   /api/agents/build             build an agent from a free-text prompt (pauses for tool confirmation)`);
    console.error(`  POST   /api/agents/build/:id/resume  resume a paused build with confirmed tools`);
    console.error(`  POST   /api/agents/:versionId/run    run an agent (pauses for tool-call approval)`);
    console.error(`  POST   /api/agents/runs/:id/resume   resume a paused run with approve/reject decisions`);
    console.error(`  POST   /api/agents/:versionId/publish   score + sanitize + submit for review`);
    console.error(`  GET    /api/review-submissions          list the admin review queue`);
    console.error(`  POST   /api/review-submissions/:id/decide   approve / request changes / reject`);
    console.error(`  GET    /api/marketplace                 list published (sanitized) agents`);
    console.error(`  POST   /api/webhooks/:versionId         trigger a webhook-configured agent (verified, async)`);
    console.error(`  GET    /api/agents/runs/pending          every run still waiting on a human approval`);
    console.error(`health check: http://localhost:${config.PORT}/healthz`);
  });

  httpServer.on("error", (error) => {
    console.error("Fatal error starting server:", error);
    process.exit(1);
  });
}

main().catch((error) => {
  console.error("Fatal error during startup:", error);
  process.exit(1);
});
