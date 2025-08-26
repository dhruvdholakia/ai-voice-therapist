import Fastify from "fastify";
import cors from "@fastify/cors";
// import 'dotenv/config';
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, "../.env") });


import { ZodError, z } from "zod";
import { QdrantClient } from "@qdrant/js-client-rest";
import OpenAI from "openai";

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });
const qdrant = new QdrantClient({ url: process.env.QDRANT_URL || "http://localhost:6333" });
const COLLECTION = "epics_v1"; // create & ingest separately per your pipeline

const ReqSchema = z.object({
  query: z.string().min(1),
  lang: z.enum(["en", "hi", "auto"]).default("auto"),
  k: z.number().min(1).max(4).default(4)
});

function trim(s: string, n=500) { return s.length <= n ? s : s.slice(0, n-1) + "…"; }

async function embed(query: string) {
  const r = await client.embeddings.create({ model: "text-embedding-3-large", input: query });
  return r.data[0].embedding;
}

app.post("/kb/search", async (req, res) => {
  if (req.headers["x-crisis"] === "1") {
    return res.send({ passages: [] });
  }
  let parsed;
  try { parsed = ReqSchema.parse(req.body || {}); }
  catch (e) { 
    if (e instanceof ZodError) return res.code(400).send({ error: e.errors });
    throw e;
  }

  const vector = await embed(parsed.query);
  const start = Date.now();
  let results: any[] = [];
  try {
    const rr = await qdrant.search(COLLECTION, {
      vector, limit: 30, with_payload: true, score_threshold: 0.05,
      // language filter would be: filter: { must: [{ key:"language", match:{ value: parsed.lang }}] }
    });
    results = rr;
  } catch (e) {
    // If collection not found or Qdrant not running, return a tiny curated fallback.
    return res.send({ passages: [
      { passage: "Sometimes we feel torn between duty and compassion. Many find it helpful to pause, breathe, and choose the path that reduces harm—to self and others.",
        source: { work:"general", book:"", chapter:"", verse_range:"", edition:"" },
        language: parsed.lang, sensitive_tags: [] }
    ]});
  }
  const top = results.slice(0, parsed.k).map((r: any) => ({
    passage: trim(r.payload.text || ""),
    source: {
      work: r.payload.work, book: r.payload.book, chapter: r.payload.chapter,
      verse_range: r.payload.verse_range, edition: r.payload.source_edition
    },
    language: r.payload.language,
    sensitive_tags: r.payload.sensitive_tags || []
  }));
  const latency = Date.now() - start;
  res.header("x-kb-latency-ms", String(latency));
  return res.send({ passages: top });
});

app.get("/healthz", async () => ({ ok: true }));

app.listen({ port: 8081, host: "0.0.0.0" }).then(() => {
  console.log("KB service on :8081");
}).catch((err) => {
  console.error(err); process.exit(1);
});
