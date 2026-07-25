import argon2 from "argon2";

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(encodedHash: string, password: string): Promise<boolean>;
  needsRehash(encodedHash: string): boolean;
}

export class Argon2idPasswordHasher implements PasswordHasher {
  // Enforce OWASP recommendations: memoryCost = 19456 (19MB), timeCost = 2, parallelism = 1
  private static readonly DEFAULT_OPTIONS = {
    type: argon2.argon2id,
    memoryCost: 19456,
    timeCost: 2,
    parallelism: 1,
  };

  public async hash(password: string): Promise<string> {
    if (!password || password.length < 8) {
      throw new Error("Password must be at least 8 characters long");
    }
    if (password.length > 128) {
      throw new Error("Password must not exceed 128 characters");
    }
    return argon2.hash(password, Argon2idPasswordHasher.DEFAULT_OPTIONS);
  }

  public async verify(encodedHash: string, password: string): Promise<boolean> {
    if (!encodedHash || !password) {
      return false;
    }
    try {
      return await argon2.verify(encodedHash, password);
    } catch {
      return false;
    }
  }

  public needsRehash(encodedHash: string): boolean {
    return !encodedHash.startsWith("$argon2id$");
  }
}
