import fetch from "node-fetch";
import { TelephonyAdapter } from "./adapter.js";

/**
 * Thin Vapi adapter. These calls would hit Vapi's REST endpoints.
 * Replace placeholders with actual Vapi API calls + auth headers.
 */
export class VapiAdapter implements TelephonyAdapter {
  constructor(private cfg: { apiKey: string }) {}

  async start(callId: string) {
    // Usually Vapi calls you via webhook on call start; this is a stub.
    return;
  }

  async speak(callId: string, textOrAudio: { text?: string; audioUrl?: string }) {
    // POST to Vapi: say text or play TTS
    // await fetch(`https://api.vapi.ai/calls/${callId}/speak`, { ... })
    return;
  }

  async escalate(callId: string, hotlineNumber: string) {
    // POST to Vapi: bridge to hotlineNumber
    // await fetch(`https://api.vapi.ai/calls/${callId}/bridge`, { ... })
    return;
  }

  async end(callId: string) {
    // End call if needed
    return;
  }
}
