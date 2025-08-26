# Voice Therapist (Vapi-first) — Starter Repo

This is a **Vapi-first** voice AI therapist starter you can run locally and extend.
It keeps **privacy-first** (no transcripts/audio persisted) and supports **optional, opt-in** cultural references from Hindu epics via a small RAG service.

## Monorepo
- `apps/orchestrator` — Fastify service handling Vapi webhooks, OpenAI Realtime session, tool gating, crisis escalation, metadata.
- `apps/kb` — LangChain.js + Qdrant service providing `/kb/search` (only used when caller opts in).
- `apps/admin` — Next.js dashboard (password-protected via reverse proxy or edge) showing basic KPIs.
- `packages/shared` — shared types/helpers.

What’s inside

apps/orchestrator – Fastify webhooks for Vapi, Realtime tool stubs, KB/circuit gating, escalation stub, metadata-only pattern.
apps/kb – LangChain/Qdrant-ready /kb/search service (vector search with an inline fallback), OpenAI embeddings.
apps/admin – Minimal Next.js dashboard (hook it to an eventual /metrics endpoint).
packages/shared – Shared types + pino logger.
docker-compose.yml – Qdrant + Mongo for local dev.
.env.example – OpenAI, Vapi, Mongo, Qdrant, hotline, etc.
README.md – Quickstart + Vapi setup pointers.

TelephonyAdapter interface + VapiAdapter stub so you can later swap to Twilio/Telnyx without touching the therapist logic.

## Quick start

1) **Prereqs**
   - Node 18+
   - Docker Desktop (for Qdrant & Mongo)

2) **Bootstrap**
```bash
cp .env.example .env
docker compose up -d
npm install
```

3) **Run services**
```bash
# In one shell
npm run --workspace apps/kb dev

# In another shell
npm run --workspace apps/orchestrator dev

# In another (optional)
npm run --workspace apps/admin dev
```

4) **Configure Vapi**
   - Create a **Voice Agent** in Vapi.
   - Set **recordings/transcripts OFF**.
   - Enable **barge-in/interruptions**.
   - Configure webhooks to your orchestrator:
     - POST `http://localhost:8080/vapi/call-start`
     - POST `http://localhost:8080/vapi/user-input`
     - POST `http://localhost:8080/vapi/tool-call`
     - POST `http://localhost:8080/vapi/call-end`
   - For **escalation**, we provide `/escalate` — you can bridge via Vapi or your carrier.

## Important privacy note
- Persist **metadata only**: call_id, start/end, duration, language, kb_used, crisis flag, etc.
- **Never** store transcripts/audio/tool payload texts.

## Swap Vapi → Twilio/Telnyx later
All telephony is abstracted behind a `TelephonyAdapter` interface. Implement a `TwilioAdapter` later without changing the therapist logic.

---

Generated: 2025-08-17T11:32:47.914152Z
