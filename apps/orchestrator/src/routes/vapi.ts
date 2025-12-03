import { FastifyInstance, FastifyPluginAsync } from "fastify";
import { logger, SessionState } from "@starter/shared";
import { VapiAdapter } from "../telephony/vapi";
import { getDb } from "../db";
import { CFG } from "../config";
import { redactPII } from "../redact";
import { encryptMaybe } from "../crypto";

// Sessions (ephemeral, per live call)
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
    {
      $setOnInsert: {
        callId,
        startedAt: new Date(),
        lang: "en",
        transcriptOptIn: true, // set true only after consent
      },
    },
    { upsert: true }
  );
}

async function saveUserUtterance(callId: string, transcript: string, isFinal = true) {
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
    enc: CFG.enc.enabled ? { ciphertext, iv, tag } : null,
    isFinal: !!isFinal,
    meta: { source: "vapi", lang: "en" },
  });
}

// store assistant side too
export async function saveAssistantUtterance(callId: string, text: string, isFinal = true) {
  if (!CFG.storeTranscripts || !text) return;
  const db = await getDb();
  const call = await db.collection("calls").findOne(
    { callId },
    { projection: { transcriptOptIn: 1 } }
  );
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
    enc: CFG.enc.enabled ? { ciphertext, iv, tag } : null,
    isFinal: !!isFinal,
    meta: { source: "assistant", lang: "en" },
  });
}

function allowKb(s: SessionState) {
  return (
    s.kb_opt_in &&
    !s.crisis &&
    Date.now() - s.lastKbMs > KB_COOLDOWN_MS &&
    s.kbUses < MAX_KB_PER_CALL
  );
}

/**
 * Build a single chronological transcript from utterances (user + assistant, finals only)
 * and store it on the calls record.
 *
 * - Stores as `chronologicalTranscript` (array) + `chronologicalTranscriptText` (string)
 * - If encryption enabled, stores encrypted versions `chronologicalTranscriptEnc` and `chronologicalTranscriptTextEnc`
 */
async function buildAndStoreChronologicalTranscript(callId: string) {
  try {
    const db = await getDb();

    const call = await db.collection("calls").findOne(
      { callId },
      { projection: { transcriptOptIn: 1 } }
    );
    if (!call?.transcriptOptIn) return; // respect consent

    // Pull only finals; rely on ts ordering for flow
    const turns = await db
      .collection("utterances")
      .find({ callId, isFinal: { $ne: false } })
      .project({ role: 1, text: 1, enc: 1, ts: 1 })
      .sort({ ts: 1 })
      .toArray();

    // If enc enabled, we can't decrypt here (no decrypt in this process). Store encrypted JSON blobs.
    if (CFG.enc.enabled) {
      const safeArrayJson = JSON.stringify(
        turns.map(t => ({
          role: t.role,
          // keep text if present (it will be undefined when enc enabled at utterance level)
          text: t.text ?? null,
          // NOTE: enc is already encrypted per-utterance; we’re keeping the pointer only
          enc: t.enc ?? null,
          ts: t.ts,
        }))
      );
      const linesText = turns
        .map(t => {
          const label = t.role === "assistant" ? "Assistant" : "User";
          return `${label}: ${t.text ?? "[encrypted]"}`;
        })
        .join("\n");

      const transArrayEnc = encryptMaybe(safeArrayJson);
      const transTextEnc = encryptMaybe(linesText);

      await db.collection("calls").updateOne(
        { callId },
        {
          $set: {
            transcriptReadyAt: new Date(),
            chronologicalTranscriptEnc: {
              ciphertext: transArrayEnc.ciphertext,
              iv: transArrayEnc.iv,
              tag: transArrayEnc.tag,
            },
            chronologicalTranscriptTextEnc: {
              ciphertext: transTextEnc.ciphertext,
              iv: transTextEnc.iv,
              tag: transTextEnc.tag,
            },
          },
        },
        { upsert: true }
      );
      return;
    }

    // Non-encrypted path (plain text, already PII-redacted at save time)
    const chronologicalTranscript = turns.map(t => ({
      role: t.role,
      text: t.text || "",
      ts: t.ts,
    }));
    const chronologicalTranscriptText = chronologicalTranscript
      .map(t => `${t.role === "assistant" ? "Assistant" : "User"}: ${t.text}`)
      .join("\n");

    await db.collection("calls").updateOne(
      { callId },
      {
        $set: {
          transcriptReadyAt: new Date(),
          chronologicalTranscript,
          chronologicalTranscriptText,
        },
      },
      { upsert: true }
    );
  } catch (e) {
    logger.error({ e, callId }, "Failed to build/store chronological transcript");
  }
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

  // -------------------------------
  // Call start
  // -------------------------------
  app.post("/vapi/call-start", async (req, res) => {
    const body: any = req.body || {};
    const callId = body.callId || body.call_id || `call_${Date.now()}`;

    await ensureCall(callId);

    if (CFG.storeMetadata) {
      const db = await getDb();
      await db.collection("calls").updateOne(
        { callId },
        {
          $setOnInsert: {
            callId,
            startedAt: new Date(),
            lang: "en",
            transcriptOptIn: true, // keep false in prod; flip only after consent
          },
          $set: { startedAt: new Date() },
        },
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
      metrics: {},
    });
    logger.info({ callId }, "Call started");
    return res.send({ ok: true });
  });

  // -------------------------------
  // User input (FINAL user turns routed here)
  // -------------------------------
  app.post("/vapi/user-input", async (req, res) => {
    const body: any = req.body || {};
    const callId = body.callId;
    const intent = body.intent;
    const transcript: string = body.transcript ?? "";
    const isFinal = !!body.isFinal;

    if (!callId) return res.code(400).send({ ok: false, error: "missing_callId" });

    // Ensure call doc exists even if we missed call-start
    await ensureCall(callId);

    // Session is optional; don't 404 if it’s gone
    const s = sessions.get(callId);

    // Update session heuristics if present
    if (s) {
      if (intent === "opt_in_epics") s.kb_opt_in = true;

      if (typeof transcript === "string" &&
          /suicide|kill myself|end my life|आत्महत्या|मरना/i.test(transcript)) {
        s.crisis = true;
      }

      s.turnCount += 1;
    }

    // Persist the user utterance (respects consent)
    try {
      if (transcript) await saveUserUtterance(callId, transcript, isFinal);
    } catch (e) {
      req.log.error({ e, callId }, "Failed to store user utterance");
    }

    return res.send({ ok: true });
  });

  // -------------------------------
  // Tool calls (e.g., kb_search)
  // -------------------------------
  app.post("/vapi/tool-call", async (req, res) => {
    const body: any = req.body || {};
    const callId = body.callId;
    const tool = body.tool;

    if (!callId) return res.code(400).send({ ok: false, error: "missing_callId" });

    await ensureCall(callId);

    const s = sessions.get(callId);
    if (!s) {
      req.log.warn({ callId, tool }, "tool-call without session");
      return res.send({ ok: true, result: {} });
    }

    if (tool === "kb_search") {
      if (!allowKb(s)) {
        return res.send({ ok: true, result: { passages: [] } });
      }
      try {
        const r = await fetch(CFG.kbUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-CRISIS": s.crisis ? "1" : "0",
          },
          body: JSON.stringify({ query: body.query, lang: s.lang, k: 4 }),
        });
        const data = await r.json();
        s.kbUses += 1;
        s.lastKbMs = Date.now();
        return res.send({ ok: true, result: data });
      } catch (e) {
        req.log.error({ e }, "kb_search failed");
        return res.send({ ok: true, result: { passages: [] } });
      }
    }

    if (tool === "crisis_signal") {
      const result = s.crisis
        ? { risk_level: "high", reason: "heuristic", confidence: 0.7 }
        : { risk_level: "none", reason: "none", confidence: 0.9 };
      return res.send({ ok: true, result });
    }

    return res.send({ ok: true, result: {} });
  });

  // -------------------------------
  // Call end
  // -------------------------------
  app.post("/vapi/call-end", async (req, res) => {
    const body: any = req.body || {};
    const callId = body.callId;
    if (!callId) return res.code(400).send({ ok: false, error: "missing_callId" });

    const s = sessions.get(callId);

    if (CFG.storeMetadata) {
      const db = await getDb();
      await db.collection("calls").updateOne(
        { callId },
        {
          $set: {
            endedAt: new Date(),
            durationSeconds: Number(body.duration_s || 0) || null,
            endReason: body.reason || body.end_reason || null,
            tsStartRaw: body.ts_start ?? null,
            lang: s?.lang ?? "en",
            crisis_flag: !!s?.crisis,
            kb_used: !!(s && s.kbUses > 0),
            kb_count: s?.kbUses ?? 0,
          },
        },
        { upsert: true }
      );
    }

    // Fallback: build chronological transcript even if end-of-call-report didn’t arrive
    try { await buildAndStoreChronologicalTranscript(callId); } catch {}

    sessions.delete(callId);
    return res.send({ ok: true });
  });

  // -------------------------------
  // Store end-of-call report (summary + stitched transcript)
  // -------------------------------
  app.post("/vapi/end-of-call-report", async (req, res) => {
    const raw: any = req.body ?? {};

    const callId =
      raw.callId ??
      raw.call?.id ??
      raw.message?.call?.id ??
      raw.message?.conversation?.callId ??
      raw.message?.callId ??
      raw.id ??
      "unknown";

    if (!callId) return res.code(400).send({ ok: false, error: "missing_callId" });

    const summary =
      raw.message?.analysis?.summary ??
      raw.analysis?.summary ??
      null;

    const stitchedTranscript =
      raw.message?.transcript ??
      raw.transcript ??
      raw.message?.artifact?.transcript ??
      null;

    try {
      const db = await getDb();

      // Always store the summary & timestamps as metadata
      const update: any = {
        $set: {
          endedAt: new Date(),
          endOfCallReportAt: new Date(),
          reportSummary: summary,
        },
      };

      // Only store the big stitched transcript if consented
      const call = await db.collection("calls").findOne(
        { callId },
        { projection: { transcriptOptIn: 1 } }
      );

      if (call?.transcriptOptIn && stitchedTranscript) {
        const clean = redactPII(stitchedTranscript);
        const { ciphertext, iv, tag } = encryptMaybe(clean);

        if (CFG.enc.enabled) {
          update.$set.fullTranscriptEnc = { ciphertext, iv, tag };
        } else {
          update.$set.fullTranscript = clean;
        }
      }

      // Optional: keep raw for audit/debug (remove in prod if not needed)
      update.$set.rawEndOfCall = raw;

      await db.collection("calls").updateOne({ callId }, update, { upsert: true });

      // Build + store the chronological (user/assistant) transcript
      await buildAndStoreChronologicalTranscript(callId);

      req.log.info({ callId }, "end-of-call-report stored");
      return res.send({ ok: true });
    } catch (e) {
      req.log.error({ e, raw }, "failed to store end-of-call-report");
      // ACK to avoid retries; logs will alert us
      return res.send({ ok: true });
    }
  });

  // -------------------------------
  // Escalation
  // -------------------------------
  app.post("/escalate", async (req, res) => {
    const body: any = req.body || {};
    const callId = body.callId;
    await vapi.escalate(callId, CFG.hotlineNumber);
    return res.send({ ok: true });
  });

  // -------------------------------
  // Webhook fan-out
  // -------------------------------
  app.post("/vapi/webhook", async (req, res) => {
    if (!verify(req, res)) return;

    const raw: any = req.body ?? {};

    const type =
      raw.type ??
      raw.event ??
      raw.event_type ??
      raw.message?.type ??
      "unknown";

    const callId =
      raw.callId ??
      raw.call_id ??
      raw.id ??
      raw.sessionId ??
      raw.call?.id ??
      raw.message?.call?.id ??
      raw.message?.conversation?.callId ??
      "unknown";

    lastEventAt = Date.now();

    req.log.info({ type, callId, keys: Object.keys(raw || {}) }, "Vapi webhook received");
    res.header("X-Orchestrator", "ai-voice");

    // Dispatches
    if (type === "call.started" || type === "on_call_start") {
      const r = await app.inject({ method: "POST", url: "/vapi/call-start", payload: { callId } });
      return res.code(r.statusCode).send(r.body ?? { ok: true });
    }

    if (type === "user.input" || type === "on_user_input" || type === "transcript.partial") {
      const payload = {
        callId,
        intent: raw.intent,
        transcript: raw.transcript?.text ?? raw.transcript ?? "",
        isFinal: false,
      };
      const r = await app.inject({ method: "POST", url: "/vapi/user-input", payload });
      return res.code(r.statusCode).send(r.body ?? { ok: true });
    }

    // Streaming speech chunks (users + assistant)
    if (type === "speech-update" && raw.message) {
      const m = raw.message;
      const role = m.role || m.speaker || m.source || "user";
      const status = String(m.status || m.stage || m.state || "").toLowerCase();

      const transcript =
        m.transcript?.text ??
        m.transcript ??
        m.artifact?.transcript?.text ??
        m.artifact?.text ??
        m.text ??
        "";

      const isFinal =
        /final|complete|completed|commit|endpoint/.test(status) || m.isFinal === true;

      if (role === "user" && transcript && isFinal) {
        req.log.info({ callId, transcript }, "Final user transcript (speech-update)");
        const r = await app.inject({
          method: "POST",
          url: "/vapi/user-input",
          payload: { callId, transcript, intent: m.intent, isFinal: true },
        });
        if (r.statusCode !== 200) req.log.error({ status: r.statusCode, body: r.body }, "user-input inject failed");
        return res.code(r.statusCode).send(r.body ?? { ok: true });
      }

      if (role === "assistant" && transcript && isFinal) {
        try { await saveAssistantUtterance(callId, transcript, true); } catch (e) {
          req.log.error({ e, callId }, "Failed to store assistant utterance");
        }
      }

      return res.send({ ok: true });
    }

    // Legacy transcript events (finals)
    if (type === "transcript.final" || type === "transcript.partial") {
      const transcript = raw.transcript?.text ?? raw.transcript ?? "";
      if (type === "transcript.final" && transcript) {
        req.log.info({ callId, transcript }, "Final user transcript (transcript.final)");
        const r = await app.inject({
          method: "POST",
          url: "/vapi/user-input",
          payload: { callId, transcript, intent: raw.intent, isFinal: true },
        });
        return res.code(r.statusCode).send(r.body ?? { ok: true });
      }
      return res.send({ ok: true });
    }

    // Conversation batch updates (can include both roles)
    if (type === "conversation-update") {
      try {
        const convo = raw.message?.conversation as Array<{ role?: string; content?: string; status?: string }> | undefined;
        if (Array.isArray(convo) && convo.length) {
          const last = convo[convo.length - 1];
          const looksFinal = !last?.status || /final|completed/i.test(String(last?.status));

          if (looksFinal && last?.content) {
            if (last.role === "user") {
              req.log.info({ callId, text: last.content }, "Final user transcript (conversation-update)");
              const r = await app.inject({
                method: "POST",
                url: "/vapi/user-input",
                payload: { callId, transcript: last.content, isFinal: true },
              });
              return res.code(r.statusCode).send(r.body ?? { ok: true });
            } else if (last.role === "assistant") {
              try { await saveAssistantUtterance(callId, last.content, true); } catch (e) {
                req.log.error({ e, callId }, "Failed to store assistant utterance (conversation-update)");
              }
              return res.send({ ok: true });
            }
          }
        }
      } catch (e: any) {
        req.log.error({ err: e?.message, callId }, "conversation-update handling failed");
      }
      return res.send({ ok: true });
    }

    if (type === "tool.call" || type === "on_tool_call") {
      const payload = {
        callId,
        tool: raw.tool?.name || raw.tool,
        query: raw.tool?.args?.query ?? raw.query,
      };
      const r = await app.inject({ method: "POST", url: "/vapi/tool-call", payload });
      return res.code(r.statusCode).send(r.body ?? { ok: true });
    }

    if (type === "call.ended" || type === "on_call_end") {
      const payload = {
        callId,
        ts_start: raw.ts_start,
        duration_s: raw.duration_s,
        reason: raw.reason || raw.end_reason,
      };
      const r = await app.inject({ method: "POST", url: "/vapi/call-end", payload });
      return res.code(r.statusCode).send(r.body ?? { ok: true });
    }

    if (type === "end-of-call-report") {
      const r = await app.inject({
        method: "POST",
        url: "/vapi/end-of-call-report",
        payload: raw,
      });
      return res.code(r.statusCode).send(r.body ?? { ok: true });
    }

    if (type === "status-update") {
      return res.send({ ok: true });
    }

    req.log.warn({ type, callId, raw }, "Unhandled Vapi webhook event");
    return res.send({ ok: true });
  });

  app.get("/vapi/last-event", async () => ({
    lastEventAt,
    iso: lastEventAt ? new Date(lastEventAt).toISOString() : null,
  }));
};

export default registerVapiRoutes;
