module.exports = {
  apps: [
    {
      name: "orchestrator",
      cwd: "/home/aiw/public_html/ai-voice",
      script: "apps/orchestrator/dist/index.js",
      env: {
        NODE_ENV: "production",
        PORT: "8080",
        HOST: "127.0.0.1",

        MONGO_URI: "mongodb://127.0.0.1:27017/voice_therapist",

        STORE_METADATA: "true",
        STORE_TRANSCRIPTS: "true",
        TRANSCRIPTS_TTL_DAYS: "30",
        TRANSCRIPTS_ENCRYPT: "false",

        OPENAI_API_KEY: "REDACTED",
        VAPI_API_KEY: "REDACTED"
      }
    }
  ]
};