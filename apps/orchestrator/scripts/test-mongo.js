"use strict";
/// <reference types="node" />
Object.defineProperty(exports, "__esModule", { value: true });
const mongodb_1 = require("mongodb");
const uri = process.env.MONGO_URI || "mongodb://localhost:27017/voice_therapist";
async function main() {
    console.log("Connecting to Mongo:", uri);
    const client = new mongodb_1.MongoClient(uri);
    try {
        await client.connect();
        console.log("✅ Connected to MongoDB");
        const db = client.db();
        console.log("Using DB:", db.databaseName);
        // List collections
        const collections = await db.listCollections().toArray();
        console.log("Collections:", collections.map(c => c.name));
        // Insert a quick test doc
        const utterances = db.collection("utterances");
        const result = await utterances.insertOne({
            callId: "test-call-1",
            role: "user",
            transcript: "Hello from orchestrator test!",
            ts: new Date(),
        });
        console.log("Inserted doc ID:", result.insertedId);
        // Read it back
        const doc = await utterances.findOne({ callId: "test-call-1" });
        console.log("Fetched back:", doc);
    }
    catch (err) {
        console.error("❌ Error:", err);
    }
    finally {
        await client.close();
    }
}
main();
