import { FastifyInstance, FastifyPluginAsync } from "fastify";
import { CFG } from "../config.js";
import { logger, SessionState } from "@starter/shared";
import { VapiAdapter } from "../telephony/vapi.js";





const sessions = new Map<string, SessionState>();
const vapi = new VapiAdapter({ apiKey: CFG.vapiKey });
let lastEventAt: number | null = null;

const KB_COOLDOWN_MS = 2 * 60_000;
const MAX_KB_PER_CALL = 2;

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

  app.post("/vapi/call-start", async (req, res) => {
    const body: any = req.body || {};
    const callId = body.callId || body.call_id || `call_${Date.now()}`;
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

  app.post("/vapi/user-input", async (req, res) => {
    const body: any = req.body || {};
    const callId = body.callId;
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