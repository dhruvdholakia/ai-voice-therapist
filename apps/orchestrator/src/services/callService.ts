import { getDb } from "../db.js";
import { CallRecord, CallMetrics } from "../models/call.js";
import { logger } from "@starter/shared";

export class CallService {
  private static instance: CallService;
  
  static getInstance(): CallService {
    if (!CallService.instance) {
      CallService.instance = new CallService();
    }
    return CallService.instance;
  }

  async createCall(callData: Partial<CallRecord>): Promise<void> {
    try {
      const db = await getDb();
      const now = new Date();
      
      const callRecord: Partial<CallRecord> = {
        ...callData,
        callStatus: "active",
        crisis_flag: false,
        kb_used: false,
        kb_count: 0,
        kb_opt_in: false,
        turnCount: 0,
        transcriptOptIn: false, // default to false, require explicit opt-in
        createdAt: now,
        updatedAt: now,
        version: 1,
      };

      await db.collection("calls").insertOne(callRecord);
      logger.info({ callId: callData.callId }, "Call record created");
    } catch (error) {
      logger.error({ error, callId: callData.callId }, "Failed to create call record");
      throw error;
    }
  }

  async updateCall(callId: string, updates: Partial<CallRecord>): Promise<void> {
    try {
      const db = await getDb();
      
      const updateDoc = {
        ...updates,
        updatedAt: new Date(),
        $inc: { version: 1 }
      };

      const result = await db.collection("calls").updateOne(
        { callId },
        { $set: updateDoc },
        { upsert: true }
      );

      if (result.matchedCount === 0 && result.upsertedCount === 0) {
        logger.warn({ callId }, "Call record not found for update");
      }
    } catch (error) {
      logger.error({ error, callId }, "Failed to update call record");
      throw error;
    }
  }

  async endCall(callId: string, endData: {
    endReason?: string;
    durationSeconds?: number;
    endedAt?: Date;
  }): Promise<void> {
    try {
      const updates: Partial<CallRecord> = {
        callStatus: "completed",
        endedAt: endData.endedAt || new Date(),
        endReason: endData.endReason || "normal",
        durationSeconds: endData.durationSeconds,
      };

      await this.updateCall(callId, updates);
      logger.info({ callId, endReason: endData.endReason }, "Call ended");
    } catch (error) {
      logger.error({ error, callId }, "Failed to end call");
      throw error;
    }
  }

  async escalateCall(callId: string, reason: string): Promise<void> {
    try {
      const updates: Partial<CallRecord> = {
        escalated: true,
        escalatedAt: new Date(),
        escalationReason: reason,
        callStatus: "escalated",
        riskLevel: "high",
      };

      await this.updateCall(callId, updates);
      logger.info({ callId, reason }, "Call escalated");
    } catch (error) {
      logger.error({ error, callId }, "Failed to escalate call");
      throw error;
    }
  }

  async getCall(callId: string): Promise<CallRecord | null> {
    try {
      const db = await getDb();
      return await db.collection("calls").findOne({ callId });
    } catch (error) {
      logger.error({ error, callId }, "Failed to get call record");
      return null;
    }
  }

  async getCallMetrics(timeRange?: { start: Date; end: Date }): Promise<CallMetrics> {
    try {
      const db = await getDb();
      const collection = db.collection("calls");
      
      const matchStage = timeRange 
        ? { startedAt: { $gte: timeRange.start, $lte: timeRange.end } }
        : {};

      const pipeline = [
        { $match: matchStage },
        {
          $group: {
            _id: null,
            totalCalls: { $sum: 1 },
            activeCalls: { $sum: { $cond: [{ $eq: ["$callStatus", "active"] }, 1, 0] } },
            completedCalls: { $sum: { $cond: [{ $eq: ["$callStatus", "completed"] }, 1, 0] } },
            failedCalls: { $sum: { $cond: [{ $eq: ["$callStatus", "failed"] }, 1, 0] } },
            escalatedCalls: { $sum: { $cond: ["$escalated", 1, 0] } },
            avgDuration: { $avg: "$durationSeconds" },
            crisisCalls: { $sum: { $cond: ["$crisis_flag", 1, 0] } },
            kbUsedCalls: { $sum: { $cond: ["$kb_used", 1, 0] } },
            transcriptOptInCalls: { $sum: { $cond: ["$transcriptOptIn", 1, 0] } },
          }
        }
      ];

      const result = await collection.aggregate(pipeline).toArray();
      const stats = result[0] || {};

      return {
        totalCalls: stats.totalCalls || 0,
        activeCalls: stats.activeCalls || 0,
        completedCalls: stats.completedCalls || 0,
        failedCalls: stats.failedCalls || 0,
        escalatedCalls: stats.escalatedCalls || 0,
        averageDuration: Math.round(stats.avgDuration || 0),
        crisisRate: stats.totalCalls ? (stats.crisisCalls / stats.totalCalls) * 100 : 0,
        kbUsageRate: stats.totalCalls ? (stats.kbUsedCalls / stats.totalCalls) * 100 : 0,
        transcriptOptInRate: stats.totalCalls ? (stats.transcriptOptInCalls / stats.totalCalls) * 100 : 0,
      };
    } catch (error) {
      logger.error({ error }, "Failed to get call metrics");
      throw error;
    }
  }

  async getRecentCalls(limit = 50): Promise<CallRecord[]> {
    try {
      const db = await getDb();
      return await db.collection("calls")
        .find({})
        .sort({ startedAt: -1 })
        .limit(limit)
        .toArray();
    } catch (error) {
      logger.error({ error }, "Failed to get recent calls");
      return [];
    }
  }

  async addRemarks(callId: string, remarks: string, tags?: string[]): Promise<void> {
    try {
      const updates: Partial<CallRecord> = { remarks };
      if (tags) {
        updates.tags = tags;
      }
      
      await this.updateCall(callId, updates);
      logger.info({ callId }, "Remarks added to call");
    } catch (error) {
      logger.error({ error, callId }, "Failed to add remarks");
      throw error;
    }
  }
}