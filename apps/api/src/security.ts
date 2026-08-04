import crypto from "node:crypto";
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export function assertPasswordPolicy(value: string) {
  if (
    value.length < 12 ||
    value.length > 128 ||
    ["password", "qwerty", "letmein", "welcome", "admin"].some((x) =>
      value
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "")
        .includes(x),
    )
  )
    throw new Error("Password does not meet security policy");
}
export function base32(bytes: Buffer) {
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  let out = "";
  for (let i = 0; i < bits.length; i += 5)
    out += ALPHABET[parseInt(bits.slice(i, i + 5).padEnd(5, "0"), 2)];
  return out;
}
function decode(value: string) {
  let bits = "";
  for (const c of value.toUpperCase().replace(/=+$/, "")) {
    const i = ALPHABET.indexOf(c);
    if (i < 0) throw new Error("Invalid secret");
    bits += i.toString(2).padStart(5, "0");
  }
  const out = [];
  for (let i = 0; i + 8 <= bits.length; i += 8)
    out.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(out);
}
export function totp(secret: string, time = Date.now(), offset = 0) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(time / 30000) + offset));
  const digest = crypto
    .createHmac("sha1", decode(secret))
    .update(counter)
    .digest();
  const i = digest.at(-1)! & 15;
  const n =
    ((digest[i]! & 127) << 24) |
    (digest[i + 1]! << 16) |
    (digest[i + 2]! << 8) |
    digest[i + 3]!;
  return String(n % 1_000_000).padStart(6, "0");
}
export function verifyTotp(secret: string, code: string) {
  return (
    /^\d{6}$/.test(code) &&
    [-1, 0, 1].some((offset) =>
      crypto.timingSafeEqual(
        Buffer.from(totp(secret, Date.now(), offset)),
        Buffer.from(code),
      ),
    )
  );
}
function key() {
  const value =
    process.env.MFA_ENCRYPTION_KEY || process.env.ENCRYPTION_KEY || "";
  if (!/^[0-9a-f]{64}$/i.test(value))
    throw new Error("MFA encryption unavailable");
  return Buffer.from(value, "hex");
}
export function encryptMfa(userId: string, secret: string) {
  const iv = crypto.randomBytes(12),
    cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(`govos.tenant.mfa-secret:v1:${userId}`));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify({ secret })),
    cipher.final(),
  ]);
  return {
    version: 1,
    algorithm: "aes-256-gcm",
    keyId: "v1",
    iv: iv.toString("hex"),
    authTag: cipher.getAuthTag().toString("hex"),
    ciphertext: ciphertext.toString("hex"),
  };
}
export function decryptMfa(userId: string, e: any) {
  if (e?.version !== 1 || e?.algorithm !== "aes-256-gcm" || e?.keyId !== "v1")
    throw new Error("Invalid MFA credential");
  const d = crypto.createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(e.iv, "hex"),
  );
  d.setAAD(Buffer.from(`govos.tenant.mfa-secret:v1:${userId}`));
  d.setAuthTag(Buffer.from(e.authTag, "hex"));
  const p = JSON.parse(
    Buffer.concat([
      d.update(Buffer.from(e.ciphertext, "hex")),
      d.final(),
    ]).toString(),
  );
  if (typeof p.secret !== "string") throw new Error("Invalid MFA credential");
  return p.secret;
}
function pepper() {
  const value = process.env.RECOVERY_CODE_PEPPER || "";
  if (!/^[0-9a-f]{64}$/i.test(value))
    throw new Error("Recovery protection unavailable");
  return Buffer.from(value, "hex");
}
export function recoveryDigest(userId: string, code: string) {
  return crypto
    .createHmac("sha256", pepper())
    .update(
      `govos.tenant.mfa-recovery-code:v1:${userId}:${code.replace(/[\s-]/g, "").toUpperCase()}`,
    )
    .digest("hex");
}
export function makeRecoveryCodes(userId: string) {
  const raw = Array.from({ length: 10 }, () =>
    `${crypto.randomBytes(2).toString("hex")}-${crypto.randomBytes(2).toString("hex")}`.toUpperCase(),
  );
  return {
    raw,
    stored: {
      version: 1,
      codes: raw.map((code) => ({
        version: 1,
        pepperId: "v1",
        digest: recoveryDigest(userId, code),
        consumedAt: null,
      })),
    },
  };
}
