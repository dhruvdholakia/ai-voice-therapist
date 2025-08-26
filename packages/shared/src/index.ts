import pino from "pino";

export const logger = pino({ level: process.env.LOG_LEVEL || "info" });

export type RiskLevel = "none" | "low" | "moderate" | "high";

export interface SessionState {
  callId: string;
  lang: "en" | "hi" | "auto";
  kb_opt_in: boolean;
  crisis: boolean;
  lastKbMs: number;
  kbUses: number;
  turnCount: number;
  metrics: {
    lastTurnLatencyMs?: number;
    latencyP95Ms?: number;
  }
}
