export interface TelephonyAdapter {
  start(callId: string): Promise<void>;
  speak(callId: string, textOrAudio: { text?: string; audioUrl?: string }): Promise<void>;
  escalate(callId: string, hotlineNumber: string): Promise<void>;
  end(callId: string): Promise<void>;
}
