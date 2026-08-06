import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

function getMasterKey(): string {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("ENCRYPTION_KEY is required in production.");
    }
    throw new Error("ENCRYPTION_KEY is required.");
  }
  return key;
}

/**
 * Derives a key deterministically from the tenant ID and master key.
 */
function deriveKey(tenantId: string, masterKey: string): Buffer {
  return crypto.pbkdf2Sync(masterKey, tenantId, 100000, 32, "sha256");
}

export function encryptForTenant(tenantId: string, plainText: string): string {
  const masterKey = getMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = deriveKey(tenantId, masterKey);

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(plainText, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag();

  return `${iv.toString("hex")}.${tag.toString("hex")}.${encrypted}`;
}

export function decryptForTenant(
  tenantId: string,
  cipherTextStr: string,
): string {
  const masterKey = getMasterKey();

  const parts = cipherTextStr.split(".");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted payload format.");
  }

  const [ivHex, tagHex, encryptedHex] = parts as [string, string, string];

  const iv = Buffer.from(ivHex, "hex");
  const tag = Buffer.from(tagHex, "hex");
  const key = deriveKey(tenantId, masterKey);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  try {
    let decrypted = decipher.update(encryptedHex, "hex", "utf8") as string;
    decrypted += decipher.final("utf8") as string;
    return decrypted;
  } catch (error) {
    throw new Error("Failed to decrypt payload. Do not log the payload.");
  }
}
