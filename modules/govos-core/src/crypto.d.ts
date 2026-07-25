export interface EncryptedTaskEnvelope {
    version: 1;
    algorithm: "aes-256-gcm";
    keyId: string;
    iv: string;
    authTag: string;
    ciphertext: string;
}
export declare function encryptPayload(payload: any, keyHex: string, keyId: string): EncryptedTaskEnvelope;
export declare function decryptPayload(envelope: EncryptedTaskEnvelope, keyHex: string): any;
//# sourceMappingURL=crypto.d.ts.map