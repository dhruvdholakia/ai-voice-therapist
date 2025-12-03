#!/usr/bin/env tsx
/**
 * Database inspection tool
 * Usage: npm run check-db
 */

import { MongoClient } from "mongodb";
import { CFG } from "../src/config.js";

async function main() {
  console.log("🔍 Checking database...");
  console.log("MongoDB URI:", CFG.mongoUri);
  
  const client = new MongoClient(CFG.mongoUri);
  
  try {
    await client.connect();
    console.log("✅ Connected to MongoDB");
    
    const db = client.db();
    console.log("📊 Database:", db.databaseName);
    
    // List all collections
    const collections = await db.listCollections().toArray();
    console.log("\n📁 Collections:");
    collections.forEach(col => {
      console.log(`  - ${col.name}`);
    });
    
    // Check calls collection
    const callsCollection = db.collection("calls");
    const callsCount = await callsCollection.countDocuments();
    console.log(`\n📞 Calls collection: ${callsCount} documents`);
    
    if (callsCount > 0) {
      console.log("\n🔍 Recent calls:");
      const recentCalls = await callsCollection
        .find({})
        .sort({ startedAt: -1 })
        .limit(5)
        .project({
          callId: 1,
          fromNumber: 1,
          toNumber: 1,
          startedAt: 1,
          endedAt: 1,
          durationSeconds: 1,
          callStatus: 1,
          crisis_flag: 1,
          kb_used: 1
        })
        .toArray();
      
      recentCalls.forEach(call => {
        console.log(`  📞 ${call.callId}`);
        console.log(`     From: ${call.fromNumber || 'unknown'} → To: ${call.toNumber || 'unknown'}`);
        console.log(`     Started: ${call.startedAt?.toISOString()}`);
        console.log(`     Status: ${call.callStatus}, Duration: ${call.durationSeconds}s`);
        console.log(`     Crisis: ${call.crisis_flag ? '🚨 YES' : '✅ No'}, KB Used: ${call.kb_used ? '📚 Yes' : '❌ No'}`);
        console.log("");
      });
    }
    
    // Check utterances collection
    const utterancesCollection = db.collection("utterances");
    const utterancesCount = await utterancesCollection.countDocuments();
    console.log(`💬 Utterances collection: ${utterancesCount} documents`);
    
    if (utterancesCount > 0) {
      console.log("\n🔍 Recent utterances:");
      const recentUtterances = await utterancesCollection
        .find({})
        .sort({ ts: -1 })
        .limit(3)
        .project({
          callId: 1,
          role: 1,
          text: 1,
          ts: 1,
          isFinal: 1
        })
        .toArray();
      
      recentUtterances.forEach(utterance => {
        const text = utterance.text || '[encrypted]';
        const preview = text.length > 50 ? text.substring(0, 50) + '...' : text;
        console.log(`  💬 ${utterance.role}: "${preview}"`);
        console.log(`     Call: ${utterance.callId}, Time: ${utterance.ts?.toISOString()}`);
        console.log("");
      });
    }
    
    // Show indexes
    console.log("\n📊 Database indexes:");
    for (const collection of ['calls', 'utterances']) {
      try {
        const indexes = await db.collection(collection).listIndexes().toArray();
        console.log(`\n  ${collection}:`);
        indexes.forEach(index => {
          const keys = Object.keys(index.key).join(', ');
          console.log(`    - ${index.name}: {${keys}}`);
        });
      } catch (e) {
        console.log(`    - Collection '${collection}' not found`);
      }
    }
    
  } catch (error) {
    console.error("❌ Error:", error);
  } finally {
    await client.close();
    console.log("\n👋 Disconnected from MongoDB");
  }
}

main().catch(console.error);