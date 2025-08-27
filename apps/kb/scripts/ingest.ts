/**
 * apps/kb/scripts/ingest.ts
 *
 * Minimal-but-solid ingestion tool for your “optional cultural references” KB.
 * - Reads JSONL files from apps/kb/data/*.jsonl
 * - Creates the Qdrant collection if missing (idempotent; won’t wipe)
 * - Embeds in batches using OpenAI embeddings
 * - Upserts vectors with rich payload (metadata stays available to your KB search API)
 *
 * JSONL schema per line:
 * {"id":"mbh_12.110.10","canon":"Mahabharata","book":"12","verse":"110.10","lang":"en","text":"...", "source":"...", "tags":["dharma","compassion"]}
 */
/// <reference types="node" />

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { QdrantClient } from '@qdrant/js-client-rest';
import OpenAI from 'openai';
import { v5 as uuidv5 } from 'uuid';

// ---------- UTILS ----------
function env(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} missing`);
  return v;
}
function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- CONFIG ----
const COLLECTION = env('KB_COLLECTION', 'epics_kb');
const DATA_DIR = env('KB_DATA_DIR', path.join(process.cwd(), 'apps/kb/data'));
const MODEL = env('KB_EMBED_MODEL', 'text-embedding-3-small'); // 1536 dims
const BATCH = parseInt(env('KB_EMBED_BATCH', '64'), 10);
const VEC_SIZE = parseInt(env('KB_EMBED_SIZE', '1536'), 10);
const UUID_NS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';


// Soft limits: backoff if OpenAI rate-limits (very simple)
const RETRY_MAX = 4;
const RETRY_BASE_MS = 800;

const openai = new OpenAI({ apiKey: requireEnv('OPENAI_API_KEY') });
const qdrant = new QdrantClient({ url: requireEnv('QDRANT_URL') });

// ---- Types ----
type KBRecord = {
  id: string;              // unique id per chunk (required)
  text: string;            // text to embed (required)
  lang?: 'en' | 'hi' | string;
  canon?: string;          // e.g., "Mahabharata" | "Ramayana"
  book?: string;           // book / kanda / parva number/name
  verse?: string;          // verse/section id
  source?: string;         // URL or edition reference
  tags?: string[];         // free-form tags: ["dharma","compassion"]
  // you can add more fields; all fields are copied to payload
};
// ---------- QDRANT ----------
async function ensureCollection() {
  try {
    await qdrant.getCollection(COLLECTION);
    console.log(`Collection "${COLLECTION}" exists`);
  } catch {
    console.log(`Creating collection "${COLLECTION}" (size=${VEC_SIZE}) …`);
    await qdrant.createCollection(COLLECTION, {
      vectors: { size: VEC_SIZE, distance: 'Cosine' },
    });
  }
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const RETRY_MAX = 4;
  const RETRY_BASE_MS = 800;

  for (let attempt = 0; attempt <= RETRY_MAX; attempt++) {
    try {
      const r = await openai.embeddings.create({ model: MODEL, input: texts });
      return r.data.map((d) => d.embedding as number[]);
    } catch (err: any) {
      const code = err?.status || err?.code;
      const retryable = code === 429 || code === 500 || code === 503;
      if (attempt < RETRY_MAX && retryable) {
        const delay = RETRY_BASE_MS * 2 ** attempt;
        console.warn(`OpenAI embed failed (attempt ${attempt + 1}: ${code}). Retrying in ${delay}ms`);
        await delayMs(delay);
        continue;
      }
      console.error('OpenAI embed failed (final):', err);
      throw err;
    }
  }
  // Should never get here
  throw new Error('embedBatch retry loop exhausted unexpectedly');
}

function listJsonlFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).map((f) => path.join(dir, f));
}

async function ingestFile(filePath: string): Promise<number> {
  console.log(`\nIngesting: ${filePath}`);
  const rl = readline.createInterface({
    input: fs.createReadStream(filePath, { encoding: 'utf-8' }),
    crlfDelay: Infinity,
  });

  const buffer: KBRecord[] = [];
  let total = 0;


   async function flush() {
    if (!buffer.length) return;
    const vecs = await embedBatch(buffer.map((b) => b.text));
    const points = buffer.map((b, i) => {
      const stableUuid = uuidv5(b.id, UUID_NS); // deterministic per b.id
      return {
        id: stableUuid, // <-- Qdrant-friendly ID
        vector: vecs[i],
        payload: { ...b, original_id: b.id }, // keep your original string id in payload
      };
    });

    await qdrant.upsert(COLLECTION, { points, wait: true });
    total += points.length;
    console.log(`  upserted ${points.length} (running total: ${total})`);
    buffer.length = 0;
  }

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const rec = JSON.parse(trimmed) as KBRecord;
      if (!rec.id || !rec.text) {
        console.warn('  Skipping line with missing id/text');
        continue;
      }
      buffer.push(rec);
      if (buffer.length >= BATCH) await flush();
    } catch (e) {
      console.warn('  Skipping malformed line:', e);
    }
  }
  await flush();

  console.log(`Finished: ${filePath} (upserts: ${total})`);
  return total;
}

// ---------- MAIN ----------
(async () => {
  console.log('KB ingest starting…');
  console.log(`DATA_DIR = ${DATA_DIR}`);
  await ensureCollection();

  const files = listJsonlFiles(DATA_DIR);
  if (!files.length) {
    console.log('No JSONL files found. Create at least one in apps/kb/data/*.jsonl');
    console.log('Example:\n{"id":"mbh_duty_compassion_1","lang":"en","text":"Bhishma … empathy.","canon":"Mahabharata","tags":["dharma","compassion"]}');
    process.exit(0);
  }

  let total = 0;
  for (const f of files) total += await ingestFile(f);
  console.log(`\nIngest complete. Total upserts: ${total}`);
})().catch((err) => {
  console.error('Ingest failed:', err);
  process.exit(1);
});