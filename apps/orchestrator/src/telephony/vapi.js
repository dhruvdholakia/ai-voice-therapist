/**
 * Thin Vapi adapter. These calls would hit Vapi's REST endpoints.
 * Replace placeholders with actual Vapi API calls + auth headers.
 */
export class VapiAdapter {
    cfg;
    constructor(cfg) {
        this.cfg = cfg;
    }
    async start(callId) {
        // Usually Vapi calls you via webhook on call start; this is a stub.
        return;
    }
    async speak(callId, textOrAudio) {
        // POST to Vapi: say text or play TTS
        // await fetch(`https://api.vapi.ai/calls/${callId}/speak`, { ... })
        return;
    }
    async escalate(callId, hotlineNumber) {
        // POST to Vapi: bridge to hotlineNumber
        // await fetch(`https://api.vapi.ai/calls/${callId}/bridge`, { ... })
        return;
    }
    async end(callId) {
        // End call if needed
        return;
    }
}
