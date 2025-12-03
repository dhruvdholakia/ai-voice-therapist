#!/usr/bin/env tsx
/**
 * Seed test data for development
 * Usage: npm run seed-test-data
 */

import { MongoClient } from "mongodb";
import { CFG } from "../src/config.js";
import { CallService } from "../src/services/callService.js";

async function main() {
  console.log("🌱 Seeding test data...");
  
  const client = new MongoClient(CFG.mongoUri);
  await client.connect();
  
  const callService = CallService.getInstance();
  
  // Create some test calls
  const testCalls = [
    {
      callId: "test-call-1",
      fromNumber: "+1234567890",
      toNumber: "+1987654321",
      startedAt: new Date(Date.now() - 3600000), // 1 hour ago
      endedAt: new Date(Date.now() - 3300000), // 55 minutes ago
      durationSeconds: 300,
      lang: "en" as const,
      transcriptOptIn: true,
      crisis_flag: false,
      kb_used: true,
      kb_count: 2,
      turnCount: 12,
      callStatus: "completed" as const,
      endReason: "normal",
      remarks: "Test call - user seemed satisfied with the conversation",
      tags: ["test", "positive"]
    },
    {
      callId: "test-call-2", 
      fromNumber: "+1555666777",
      toNumber: "+1987654321",
      startedAt: new Date(Date.now() - 7200000), // 2 hours ago
      endedAt: new Date(Date.now() - 6900000), // 1h 55m ago
      durationSeconds: 180,
      lang: "hi" as const,
      transcriptOptIn: false,
      crisis_flag: true,
      kb_used: false,
      kb_count: 0,
      turnCount: 8,
      callStatus: "escalated" as const,
      endReason: "escalated",
      escalated: true,
      escalatedAt: new Date(Date.now() - 6900000),
      escalationReason: "crisis_detected",
      riskLevel: "high" as const,
      remarks: "Crisis call - escalated to hotline",
      tags: ["crisis", "escalated"]
    },
    {
      callId: "test-call-3",
      fromNumber: "+1888999000",
      toNumber: "+1987654321", 
      startedAt: new Date(Date.now() - 1800000), // 30 minutes ago
      lang: "auto" as const,
      transcriptOptIn: true,
      crisis_flag: false,
      kb_used: false,
      kb_count: 0,
      turnCount: 3,
      callStatus: "active" as const,
      remarks: "Currently active call",
      tags: ["active"]
    }
  ];
  
  for (const callData of testCalls) {
    try {
      await callService.createCall(callData);
      console.log(`✅ Created test call: ${callData.callId}`);
    } catch (error) {
      console.log(`⚠️  Call ${callData.callId} might already exist`);
    }
  }
  
  // Add some test utterances
  const db = client.db();
  const utterances = [
    {
      callId: "test-call-1",
      role: "user",
      text: "Hello, I'm feeling really anxious today",
      ts: new Date(Date.now() - 3500000),
      isFinal: true,
      meta: { source: "vapi", lang: "en" }
    },
    {
      callId: "test-call-1", 
      role: "assistant",
      text: "I understand you're feeling anxious. That's completely valid. Can you tell me more about what's contributing to these feelings?",
      ts: new Date(Date.now() - 3480000),
      isFinal: true,
      meta: { source: "assistant", lang: "en" }
    },
    {
      callId: "test-call-2",
      role: "user", 
      text: "I don't want to live anymore",
      ts: new Date(Date.now() - 7000000),
      isFinal: true,
      meta: { source: "vapi", lang: "en" }
    }
  ];
  
  for (const utterance of utterances) {
    try {
      await db.collection("utterances").insertOne(utterance);
      console.log(`✅ Created utterance for ${utterance.callId}`);
    } catch (error) {
      console.log(`⚠️  Utterance might already exist`);
    }
  }
  
  await client.close();
  console.log("🌱 Test data seeding complete!");
}

main().catch(console.error);