import { z } from "zod";
export declare const EncryptedMfaSecretSchema: z.ZodObject<{
    version: z.ZodLiteral<1>;
    algorithm: z.ZodLiteral<"aes-256-gcm">;
    keyId: z.ZodString;
    iv: z.ZodString;
    authTag: z.ZodString;
    ciphertext: z.ZodString;
}, "strict", z.ZodTypeAny, {
    version: 1;
    algorithm: "aes-256-gcm";
    keyId: string;
    iv: string;
    authTag: string;
    ciphertext: string;
}, {
    version: 1;
    algorithm: "aes-256-gcm";
    keyId: string;
    iv: string;
    authTag: string;
    ciphertext: string;
}>;
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
export declare const StoredRecoveryCodesSchema: z.ZodObject<{
    version: z.ZodLiteral<1>;
    codes: z.ZodArray<z.ZodObject<{
        version: z.ZodLiteral<1>;
        pepperId: z.ZodString;
        digest: z.ZodString;
        consumedAt: z.ZodNullable<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        version: 1;
        pepperId: string;
        digest: string;
        consumedAt: string | null;
    }, {
        version: 1;
        pepperId: string;
        digest: string;
        consumedAt: string | null;
    }>, "many">;
}, "strict", z.ZodTypeAny, {
    version: 1;
    codes: {
        version: 1;
        pepperId: string;
        digest: string;
        consumedAt: string | null;
    }[];
}, {
    version: 1;
    codes: {
        version: 1;
        pepperId: string;
        digest: string;
        consumedAt: string | null;
    }[];
}>;
export declare function normalizeRecoveryCode(value: string): string;
export declare function encryptMfaSecret(userId: string, secret: string, keyHex: string, keyId?: string): EncryptedMfaSecret;
export declare function decryptMfaSecret(userId: string, envelope: unknown, keyHex: string): string;
export declare function hashRecoveryCode(userId: string, code: string, pepperHex: string, pepperId: string): RecoveryCodeHashRecord;
export declare function verifyAndConsumeRecoveryCode(userId: string, code: string, storedJSON: unknown, peppers: Record<string, string>): {
    matched: boolean;
    updatedCodes: StoredRecoveryCodes;
};
//# sourceMappingURL=platform-mfa-crypto.d.ts.map