import { MongoClient, Db } from "mongodb";
import { CFG } from "./config.js";

let client: MongoClient | null = null;
let db: Db | null = null;

export async function getDb(): Promise<Db> {
  if (db) return db;
  client = new MongoClient(CFG.mongoUri);
  await client.connect();
  db = client.db();
  return db!;
}