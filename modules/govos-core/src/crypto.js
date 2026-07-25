import * as crypto from "node:crypto";
export function encryptPayload(payload, keyHex, keyId) {
    const key = Buffer.from(keyHex, "hex");
    if (key.length !== 32) {
        throw new Error("Encryption key must be 32 bytes (64 hex characters)");
    }
    const iv = crypto.randomBytes(12); // Unpredictable 96-bit IV
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    // Bind additional authenticated data (AAD)
    const aad = {
        payloadVersion: 1,
    };
    cipher.setAAD(Buffer.from(JSON.stringify(aad)));
    let ciphertext = cipher.update(JSON.stringify(payload), "utf8", "hex");
    ciphertext += cipher.final("hex");
    return {
        version: 1,
        algorithm: "aes-256-gcm",
        keyId,
        iv: iv.toString("hex"),
        authTag: cipher.getAuthTag().toString("hex"),
        ciphertext,
    };
}
export function decryptPayload(envelope, keyHex) {
    if (envelope.version !== 1 || envelope.algorithm !== "aes-256-gcm") {
        throw new Error(`Unsupported encryption algorithm or version: ${envelope.algorithm} v${envelope.version}`);
    }
    const key = Buffer.from(keyHex, "hex");
    if (key.length !== 32) {
        throw new Error("Encryption key must be 32 bytes (64 hex characters)");
    }
    const iv = Buffer.from(envelope.iv, "hex");
    const authTag = Buffer.from(envelope.authTag, "hex");
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    // Bind AAD
    const aad = {
        payloadVersion: 1,
    };
    decipher.setAAD(Buffer.from(JSON.stringify(aad)));
    let decrypted = decipher.update(envelope.ciphertext, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return JSON.parse(decrypted);
}
//# sourceMappingURL=crypto.js.map