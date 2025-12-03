export interface CallRecord {
  // Core identifiers
  callId: string;
  vapiCallId?: string; // Vapi's internal call ID if different
  
  // Phone numbers and routing
  fromNumber?: string; // caller's phone number
  toNumber?: string; // called number (your service number)
  
  // Timestamps
  startedAt: Date;
  endedAt?: Date;
  transcriptReadyAt?: Date;
  endOfCallReportAt?: Date;
  
  // Duration and status
  durationSeconds?: number;
  endReason?: string; // "normal" | "hangup" | "error" | "escalated" | "timeout"
  callStatus: "active" | "completed" | "failed" | "escalated";
  
  // Language and localization
  lang: "en" | "hi" | "auto";
  detectedLanguage?: string;
  
  // User consent and privacy
  transcriptOptIn: boolean;
  recordingOptIn?: boolean;
  dataRetentionConsent?: boolean;
  
  // Crisis and safety
  crisis_flag: boolean;
  riskLevel?: "none" | "low" | "moderate" | "high" | "critical";
  escalated?: boolean;
  escalatedAt?: Date;
  escalationReason?: string;
  
  // Knowledge base usage
  kb_used: boolean;
  kb_count: number;
  kb_opt_in: boolean;
  
  // Conversation metrics
  turnCount: number;
  userTurns?: number;
  assistantTurns?: number;
  averageResponseTime?: number; // ms
  
  // Quality metrics
  interruptionCount?: number;
  silenceDuration?: number; // total silence in seconds
  audioQualityScore?: number; // 0-1
  
  // Transcripts (respecting privacy settings)
  fullTranscript?: string; // full stitched transcript (plain)
  fullTranscriptEnc?: {
    ciphertext: string;
    iv: string;
    tag: string;
  };
  chronologicalTranscript?: Array<{
    role: "user" | "assistant";
    text: string;
    ts: Date;
  }>;
  chronologicalTranscriptEnc?: {
    ciphertext: string;
    iv: string;
    tag: string;
  };
  chronologicalTranscriptText?: string; // simple text format
  chronologicalTranscriptTextEnc?: {
    ciphertext: string;
    iv: string;
    tag: string;
  };
  
  // Analysis and insights
  reportSummary?: string; // AI-generated call summary
  sentiment?: "positive" | "neutral" | "negative";
  topics?: string[]; // extracted topics/themes
  keyInsights?: string[];
  
  // Technical details
  vapiModel?: string; // which Vapi model was used
  voiceId?: string; // voice/accent used
  latencyP95Ms?: number;
  errorCount?: number;
  
  // Remarks and notes
  remarks?: string; // manual notes/observations
  tags?: string[]; // categorization tags
  followUpRequired?: boolean;
  followUpNotes?: string;
  
  // Billing and cost tracking
  costUsd?: number;
  tokensUsed?: number;
  
  // Raw data for debugging (remove in production)
  rawVapiEvents?: any[];
  rawEndOfCall?: any;
  
  // Audit trail
  createdAt: Date;
  updatedAt: Date;
  version?: number; // for optimistic locking
}

export interface CallMetrics {
  totalCalls: number;
  activeCalls: number;
  completedCalls: number;
  failedCalls: number;
  escalatedCalls: number;
  averageDuration: number;
  crisisRate: number;
  kbUsageRate: number;
  transcriptOptInRate: number;
}