import * as crypto from "node:crypto";

export class AccessTokenService {
  /**
   * Generates at least 32 cryptographically random bytes returned in hex format (64 chars).
   */
  public static generateToken(): string {
    return crypto.randomBytes(32).toString("hex");
  }

  /**
   * Hashes the plaintext token using SHA-256 digest format.
   */
  public static hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  /**
   * Performs constant-time comparison of two token hashes to prevent timing side-channel attacks.
   */
  public static timingSafeCompare(hashA: string, hashB: string): boolean {
    const bufA = Buffer.from(hashA, "utf-8");
    const bufB = Buffer.from(hashB, "utf-8");
    if (bufA.length !== bufB.length) {
      return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
  }
}
