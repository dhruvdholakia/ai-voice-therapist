import { MongoClient, Db } from "mongodb";
import { CFG } from "./config.js";
import { logger } from "@starter/shared";

let client: MongoClient | null = null;
let db: Db | null = null;

export async function getDb(): Promise<Db> {
  if (db) return db;
  
  logger.info({ uri: CFG.mongoUri }, "Connecting to MongoDB");
  client = new MongoClient(CFG.mongoUri);
  await client.connect();
  db = client.db();
  
  // Create indexes for better performance
  await createIndexes(db);
  
  logger.info({ dbName: db.databaseName }, "Connected to MongoDB");
  return db!;
}

async function createIndexes(database: Db) {
  try {
    // Calls collection indexes
    await database.collection("calls").createIndex({ callId: 1 }, { unique: true });
    await database.collection("calls").createIndex({ startedAt: -1 });
    await database.collection("calls").createIndex({ callStatus: 1 });
    await database.collection("calls").createIndex({ fromNumber: 1 });
    await database.collection("calls").createIndex({ crisis_flag: 1 });
    await database.collection("calls").createIndex({ escalated: 1 });
    
    // Utterances collection indexes
    await database.collection("utterances").createIndex({ callId: 1, ts: 1 });
    await database.collection("utterances").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
    
    logger.info("Database indexes created successfully");
  } catch (error) {
    logger.error({ error }, "Failed to create database indexes");
  }
}

export async function closeDb(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
    logger.info("MongoDB connection closed");
  }
}