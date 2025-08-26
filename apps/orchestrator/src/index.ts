import Fastify from "fastify";
import cors from "@fastify/cors";
import { CFG } from "./config.js";
import { registerVapiRoutes } from "./routes/vapi.js";
import { logger } from "@starter/shared";

const app = Fastify({ logger });

await app.register(cors, { origin: true });
await app.register(registerVapiRoutes);

app.get("/healthz", async () => ({ ok: true }));
app.get("/readyz", async () => ({ ok: true }));

app.listen({ port: CFG.port, host: "0.0.0.0" }).then(() => {
  logger.info(`Orchestrator listening on :${CFG.port}`);
}).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
