import 'dotenv/config';

export const CFG = {
  port: Number(process.env.PORT || 8080),
  openaiKey: process.env.OPENAI_API_KEY || "",
  vapiKey: process.env.VAPI_API_KEY || "",
  hotlineNumber: process.env.HOTLINE_NUMBER || "",
  kbUrl: process.env.KB_URL || "http://localhost:8081/kb/search",
  adminPassword: process.env.ADMIN_PASSWORD || "changeme",
  mongoUri: process.env.MONGO_URI || "mongodb://localhost:27017/voice_therapist",
  storeMetadata: (process.env.STORE_METADATA || "true").toLowerCase() === "true",
  storeTranscripts: (process.env.STORE_TRANSCRIPTS || "false").toLowerCase() === "true",
  ttlDays: Number(process.env.TRANSCRIPTS_TTL_DAYS || "30"),
  enc: {
    enabled: (process.env.TRANSCRIPTS_ENCRYPT || "false").toLowerCase() === "true",
    keyB64: process.env.TRANSCRIPTS_ENC_KEY || "",
  }
};
