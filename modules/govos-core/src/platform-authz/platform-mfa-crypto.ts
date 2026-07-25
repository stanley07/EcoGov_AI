import * as crypto from "node:crypto";
import { z } from "zod";

// Strict validation schema for EncryptedMfaSecret
export const EncryptedMfaSecretSchema = z.object({
  version: z.literal(1),
  algorithm: z.literal("aes-256-gcm"),
  keyId: z.string().min(1),
  iv: z.string().regex(/^[0-9a-f]{24}$/i),      // exact 12-byte hex validation
  authTag: z.string().regex(/^[0-9a-f]{32}$/i), // exact 16-byte hex validation
  ciphertext: z.string().regex(/^[0-9a-f]+$/i), // valid hex string
}).strict();

export type EncryptedMfaSecret = z.infer<typeof EncryptedMfaSecretSchema>;

export interface RecoveryCodeHashRecord {
  version: 1;
  pepperId: string;
  digest: string;
  consumedAt: string | null;
}

export interface StoredRecoveryCodes {
  version: 1;
  codes: RecoveryCodeHashRecord[];
}

export const StoredRecoveryCodesSchema = z.object({
  version: z.literal(1),
  codes: z.array(z.object({
    version: z.literal(1),
    pepperId: z.string().min(1),
    digest: z.string().min(1),
    consumedAt: z.string().nullable(),
  })),
}).strict();

// 1. Consistent Normalization for Recovery Codes
export function normalizeRecoveryCode(value: string): string {
  return value.trim().replace(/[\s-]/g, "").toUpperCase();
}

// 2. Encrypt TOTP secret binding domain separated AAD
export function encryptMfaSecret(
  userId: string,
  secret: string,
  keyHex: string,
  keyId: string = "v1"
): EncryptedMfaSecret {
  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) {
    throw new Error("Encryption key must be exactly 32 bytes (64 hex characters)");
  }

  const iv = crypto.randomBytes(12); // Unpredictable 96-bit IV
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);

  // Additional Authenticated Data (AAD) for Domain Separation (canonical string)
  const aad = `govos.platform.mfa-secret:v1:${userId}`;
  cipher.setAAD(Buffer.from(aad));

  let ciphertext = cipher.update(JSON.stringify({ secret }), "utf8", "hex");
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

// 3. Decrypt TOTP secret verifying domain separated AAD & strict envelope checks
export function decryptMfaSecret(
  userId: string,
  envelope: unknown,
  keyHex: string
): string {
  // Validate envelope structure first
  const parsed = EncryptedMfaSecretSchema.parse(envelope);

  if (parsed.keyId !== "v1") {
    throw new Error("Unknown encryption key ID");
  }

  const key = Buffer.from(keyHex, "hex");
  if (key.length !== 32) {
    throw new Error("Encryption key must be exactly 32 bytes (64 hex characters)");
  }

  const iv = Buffer.from(parsed.iv, "hex");
  const authTag = Buffer.from(parsed.authTag, "hex");

  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);

  // Validate Domain Separated AAD (canonical string)
  const aad = `govos.platform.mfa-secret:v1:${userId}`;
  decipher.setAAD(Buffer.from(aad));

  let decrypted = decipher.update(parsed.ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");

  const payload = JSON.parse(decrypted);
  if (typeof payload.secret !== "string") {
    throw new Error("Invalid decrypted MFA secret format");
  }
  return payload.secret;
}

// 4. Hash recovery code with domain-separation & pepper versioning
export function hashRecoveryCode(
  userId: string,
  code: string,
  pepperHex: string,
  pepperId: string
): RecoveryCodeHashRecord {
  const normalized = normalizeRecoveryCode(code);
  const input = `govos.platform.mfa-recovery-code:v1:${userId}:${normalized}`;

  const hmac = crypto.createHmac("sha256", Buffer.from(pepperHex, "hex"));
  hmac.update(input);
  const digest = hmac.digest("hex");

  return {
    version: 1,
    pepperId,
    digest,
    consumedAt: null,
  };
}

// 5. Verify and consume recovery code transactionally with timing safe equality checks
export function verifyAndConsumeRecoveryCode(
  userId: string,
  code: string,
  storedJSON: unknown,
  peppers: Record<string, string>
): { matched: boolean; updatedCodes: StoredRecoveryCodes } {
  const parsed = StoredRecoveryCodesSchema.parse(storedJSON);
  const normalized = normalizeRecoveryCode(code);

  let matchedIdx = -1;

  // Evaluate all unconsumed codes to prevent side-channel timing leaks
  const candidateDigests = parsed.codes.map((record) => {
    if (record.consumedAt !== null) {
      return { record, expected: "dummy-digest-never-match-dummy-digest-never-match-dummy-digest" };
    }
    const pepperHex = peppers[record.pepperId];
    if (!pepperHex) {
      throw new Error(`MFA Recovery Pepper ${record.pepperId} not configured`);
    }

    const input = `govos.platform.mfa-recovery-code:v1:${userId}:${normalized}`;
    const hmac = crypto.createHmac("sha256", Buffer.from(pepperHex, "hex"));
    hmac.update(input);
    const expected = hmac.digest("hex");
    return { record, expected };
  });

  for (let i = 0; i < candidateDigests.length; i++) {
    const item = candidateDigests[i];
    if (!item) continue;
    const { record, expected } = item;
    const digestBuf = Buffer.from(record.digest, "hex");
    const expectedBuf = Buffer.from(expected, "hex");

    let isMatch = false;
    if (digestBuf.length === expectedBuf.length) {
      isMatch = crypto.timingSafeEqual(digestBuf, expectedBuf);
    }

    if (isMatch && record.consumedAt === null) {
      matchedIdx = i;
    }
  }

  if (matchedIdx !== -1) {
    const matchedCode = parsed.codes[matchedIdx];
    if (matchedCode) {
      matchedCode.consumedAt = new Date().toISOString();
    }
    return { matched: true, updatedCodes: parsed };
  }

  return { matched: false, updatedCodes: parsed };
}
