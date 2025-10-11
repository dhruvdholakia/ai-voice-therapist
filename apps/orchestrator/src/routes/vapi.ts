import { FastifyInstance, FastifyPluginAsync } from "fastify";
import { logger, SessionState } from "@starter/shared";
import { VapiAdapter } from "../telephony/vapi";
import { getDb } from "../db";
import { CFG } from "../config";
import { redactPII } from "../redact";
import { encryptMaybe } from "../crypto";


const sessions = new Map<string, SessionState>();
const vapi = new VapiAdapter({ apiKey: CFG.vapiKey });
let lastEventAt: number | null = null;

const KB_COOLDOWN_MS = 2 * 60_000;
const MAX_KB_PER_CALL = 2;


async function ensureCall(callId: string) {
  if (!CFG.storeMetadata) return;
  const db = await getDb();
  await db.collection("calls").updateOne(
    { callId },
    { $setOnInsert: { callId, startedAt: new Date(), lang: "en", transcriptOptIn: false } },
    { upsert: true }
  );
}

async function saveUserUtterance(callId: string, transcript: string) {
  if (!CFG.storeTranscripts || !transcript) return;

  const db = await getDb();
  const call = await db.collection("calls").findOne(
    { callId },
    { projection: { transcriptOptIn: 1 } }
  );
  if (!call?.transcriptOptIn) return; // only if user consented

  const clean = redactPII(transcript);
  const { ciphertext, iv, tag } = encryptMaybe(clean);

  const expiresAt = new Date(Date.now() + CFG.ttlDays * 24 * 60 * 60 * 1000);

  await db.collection("utterances").insertOne({
    callId,
    role: "user",
    ts: new Date(),
    expiresAt,
    text: CFG.enc.enabled ? undefined : clean,
    enc: CFG.enc.enabled ? { ciphertext, iv, tag } : undefined,
    meta: { source: "vapi", lang: "en" },
  });
}

// store assistant side too
export async function saveAssistantUtterance(callId: string, text: string) {
  if (!CFG.storeTranscripts || !text) return;
  const db = await getDb();
  const call = await db.collection("calls").findOne({ callId }, { projection: { transcriptOptIn: 1 } });
  if (!call?.transcriptOptIn) return;

  const clean = redactPII(text);
  const { ciphertext, iv, tag } = encryptMaybe(clean);
  const expiresAt = new Date(Date.now() + CFG.ttlDays * 24 * 60 * 60 * 1000);

  await db.collection("utterances").insertOne({
    callId,
    role: "assistant",
    ts: new Date(),
    expiresAt,
    text: CFG.enc.enabled ? undefined : clean,
    enc: CFG.enc.enabled ? { ciphertext, iv, tag } : undefined,
    meta: { source: "assistant", lang: "en" },
  });
}

function allowKb(s: SessionState) {
  return s.kb_opt_in && !s.crisis &&
    Date.now() - s.lastKbMs > KB_COOLDOWN_MS &&
    s.kbUses < MAX_KB_PER_CALL;
}

export const registerVapiRoutes: FastifyPluginAsync = async (app) => {

  const verify = (req: any, res: any) => {
    const secret = req.headers["x-vapi-secret"];
    if (process.env.VAPI_WEBHOOK_SECRET && secret !== process.env.VAPI_WEBHOOK_SECRET) {
      res.code(401).send({ ok: false, error: "unauthorized" });
      return false;
    }
    return true;
  };

  // Call start
  app.post("/vapi/call-start", async (req, res) => {
    const body: any = req.body || {};
    const callId = body.callId || body.call_id || `call_${Date.now()}`;
    await ensureCall(callId);

    if (CFG.storeMetadata) {
    const db = await getDb();
    await db.collection("calls").updateOne(
      { callId },
      { $setOnInsert: { callId, startedAt: new Date(), lang: "en", transcriptOptIn: true } }, //for now true. on production-keep it false fr initially to optin to store user transcript
      { upsert: true }
    );
  }

    sessions.set(callId, {
      callId,
      lang: "auto",
      kb_opt_in: false,
      crisis: false,
      lastKbMs: 0,
      kbUses: 0,
      turnCount: 0,
      metrics: {}
    });
    logger.info({ callId }, "Call started");
    return res.send({ ok: true });
  });

  // User input

  app.post("/vapi/user-input", async (req, res) => {
    const body: any = req.body || {};
    const { callId, intent, transcript } = req.body as any;

    try{
      await saveUserUtterance(callId, transcript);

    }
    catch(e) {
      req.log.error({ e, callId }, "Failed to store user utterance");
    }

    // const callId = body.callId;
    const s = sessions.get(callId);
    if (!s) return res.code(404).send({ ok: false, error: "session_not_found" });

    // Example: parse opting in via DTMF/voice intent signals (from Vapi NLU)
    if (body.intent === "opt_in_epics") {
      s.kb_opt_in = true;
    }

    // Example: crisis keyword heuristic (always combine with model signal)
    if (typeof body.transcript === "string" &&
        /suicide|kill myself|end my life|आत्महत्या|मरना/i.test(body.transcript)) {
      s.crisis = true;
    }

    try{
      await saveUserUtterance(callId, transcript);
    }
    catch(e) {
      req.log.error({ e, callId }, "Failed to store user utterance");
    }

    s.turnCount += 1;
    return res.send({ ok: true });
  });

  app.post("/vapi/tool-call", async (req, res) => {
    const body: any = req.body || {};
    const callId = body.callId;
    const tool = body.tool;
    const s = sessions.get(callId);
    if (!s) return res.code(404).send({ ok: false, error: "session_not_found" });

    if (tool === "kb_search") {
      if (!allowKb(s)) {
        return res.send({ ok: true, result: { passages: [] } });
      }
      // proxy to KB service
      try {
        const r = await fetch(CFG.kbUrl, {
          method: "POST",
          headers: { "content-type": "application/json", "X-CRISIS": s.crisis ? "1" : "0" },
          body: JSON.stringify({ query: body.query, lang: s.lang, k: 4 })
        });
        const data = await r.json();
        s.kbUses += 1;
        s.lastKbMs = Date.now();
        return res.send({ ok: true, result: data });
      } catch (e) {
        return res.send({ ok: true, result: { passages: [] } });
      }
    }

      if (tool === "crisis_signal") {
        // You would ask the model or run your classifier; here we just echo the session state.
        const result = s.crisis ? { risk_level: "high", reason: "heuristic", confidence: 0.7 } :
                                  { risk_level: "none", reason: "none", confidence: 0.9 };
        return res.send({ ok: true, result });
      }

    return res.send({ ok: true, result: {} });
  });

  app.post("/vapi/call-end", async (req, res) => {
    const body: any = req.body || {};
    const callId = body.callId;
    const s = sessions.get(callId);
    if (!s) return res.send({ ok: true });

    // Persist metadata only (TODO: write to Mongo). Example:
    const meta = {
      callId,
      ts_start: body.ts_start || new Date(Date.now() - 60_000).toISOString(),
      ts_end: new Date().toISOString(),
      duration_s: Number(body.duration_s || 60),
      lang: s.lang,
      crisis_flag: s.crisis,
      kb_used: s.kbUses > 0,
      kb_count: s.kbUses,
      end_reason: body.reason || "normal",
    };
    // console.log("METADATA:", meta);

    sessions.delete(callId);
    return res.send({ ok: true });
  });

  app.post("/escalate", async (req, res) => {
    const body: any = req.body || {};
    const callId = body.callId;
    await vapi.escalate(callId, CFG.hotlineNumber);
    return res.send({ ok: true });
  });


  // NEW: single project webhook that dispatches by event type
  app.post("/vapi/webhook", async (req, res) => {
  if (!verify(req, res)) return;

  const body: any = req.body || {};
  const type = body.type || body.event || body.event_type;
  const callId = body.callId || body.call_id || body.id || "unknown";
  lastEventAt = Date.now();

  // explicit log + response fingerprint
  req.log.info({ type, callId }, "Vapi webhook received");
  res.header("X-Orchestrator", "ai-voice");

  if (type === "call.started" || type === "on_call_start") {
    const payload = { callId };
    const r = await app.inject({ method: "POST", url: "/vapi/call-start", payload });
    return res.code(r.statusCode).send(r.json());
  }

  if (type === "user.input" || type === "on_user_input" || type === "transcript.partial") {
    const payload = {
      callId,
      intent: body.intent,
      transcript: body.transcript,
    };
    const r = await app.inject({ method: "POST", url: "/vapi/user-input", payload });
    return res.code(r.statusCode).send(r.json());
  }

  if (type === "tool.call" || type === "on_tool_call") {
    const payload = {
      callId,
      tool: body.tool?.name || body.tool,
      query: body.tool?.args?.query ?? body.query,
    };
    const r = await app.inject({ method: "POST", url: "/vapi/tool-call", payload });
    return res.code(r.statusCode).send(r.json());
  }

  if (type === "call.ended" || type === "on_call_end") {
    const payload = {
      callId,
      ts_start: body.ts_start,
      duration_s: body.duration_s,
      reason: body.reason || body.end_reason,
    };
    const r = await app.inject({ method: "POST", url: "/vapi/call-end", payload });
    return res.code(r.statusCode).send(r.json());
  }

  // a) speech-update: Vapi sends chunks as user/assistant. Act on final user chunks.
  if (type === "speech-update" && body.message) {
    const m = body.message;
    // Examples you might see:
    // m.role: "user" | "assistant"
    // m.status: "started" | "partial" | "final"
    // m.transcript or m.artifact?.transcript?.text (shape varies by model)
    if (m.role === "user" && (m.status === "final" || m.status === "completed")) {
      const transcript =
        m.transcript?.text ??
        m.transcript ??
        m.artifact?.transcript?.text ??
        m.artifact?.text ??
        "";
      if (transcript) {
        req.log.info({ callId, transcript }, "Final user transcript");
        const r = await app.inject({
          method: "POST",
          url: "/vapi/user-input",
          payload: { callId, transcript, intent: m.intent },
        });
        return res.code(r.statusCode).send(r.json());
      }
    }
    // acknowledge other speech-update chunks
    return res.send({ ok: true });
  }

  // b) transcript.partial / transcript.final (some configs use these)
  if (type === "transcript.final" || type === "transcript.partial") {
    const transcript = body.transcript?.text ?? body.transcript ?? "";
    if (type === "transcript.final" && transcript) {
      req.log.info({ callId, transcript }, "Final user transcript (legacy type)");
      const r = await app.inject({
        method: "POST",
        url: "/vapi/user-input",
        payload: { callId, transcript, intent: body.intent },
      });
      return res.code(r.statusCode).send(r.json());
    }
    return res.send({ ok: true });
  }

  // c) conversation-update (contains a rolling log). You can ignore or mine user turns.
  if (type === "conversation-update") {
    // Optional: scan body.message(s)/conversation for the latest user text and route on "final".
    return res.send({ ok: true });
  }

  // d) status-update (e.g., in-progress, completed). You can just ack.
  if (type === "status-update") {
    return res.send({ ok: true });
  }
  

  // default: acknowledge unknown events so Vapi doesn't retry forever
  req.log.warn({ type, callId, body }, "unhandled Vapi webhook event");
  return res.send({ ok: true });
});

app.get("/vapi/last-event", async () => ({
  lastEventAt,
  iso: lastEventAt ? new Date(lastEventAt).toISOString() : null
  
}));


}

export default registerVapiRoutes;