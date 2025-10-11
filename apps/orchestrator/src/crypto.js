import crypto from "node:crypto";
import { CFG } from "./config";
const KEY = CFG.enc.enabled && CFG.enc.keyB64 ? Buffer.from(CFG.enc.keyB64, "base64") : null;
export function encryptMaybe(plaintext) {
    if (!CFG.enc.enabled || !KEY)
        return {};
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
    const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();
    return { ciphertext: enc.toString("base64"), iv: iv.toString("base64"), tag: tag.toString("base64") };
}
