import { MongoClient } from "mongodb";
import { CFG } from "./config";
let client = null;
let db = null;
export async function getDb() {
    if (db)
        return db;
    client = new MongoClient(CFG.mongoUri);
    await client.connect();
    db = client.db();
    return db;
}
