/**
 * Realtime session stub.
 * In production: create an OpenAI Realtime session and register tools.
 * Here we only define tool schemas and a mock call pattern.
 */

export const tools = [
  {
    name: "kb_search",
    description: "Optional cultural references (EN/HI), paraphrased.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string" },
        lang: { type: "string", enum: ["en", "hi", "auto"] },
        k: { type: "number", minimum: 1, maximum: 4 }
      },
      required: ["query"]
    }
  },
  {
    name: "crisis_signal",
    description: "Returns risk assessment for crisis escalation.",
    parameters: { type: "object", properties: {} }
  }
];

export class RealtimeSession {
  constructor(private callId: string, private cfg: { openaiKey: string }) {}

  async start() {
    // Create OpenAI Realtime WS and register tools.
    // Stream audio back to Vapi via Vapi's streaming connection (managed by Vapi).
  }

  async stop() {
    // Close WS, cleanup
  }
}
