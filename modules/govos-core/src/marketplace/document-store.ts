import * as crypto from "node:crypto";

export interface CreateUploadInput {
  tenantId: string;
  applicationId: string;
  documentType: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  contentHash: string; // SHA-256 hash
}

export interface CreateUploadResult {
  storageKey: string;
  uploadUrl: string;
}

export interface VerifyObjectInput {
  storageKey: string;
  expectedSize: number;
  expectedHash: string;
}

export interface VerifiedObject {
  isValid: boolean;
  scanStatus: "passed" | "failed";
}

export interface MarketplaceDocumentStore {
  createUpload(input: CreateUploadInput): Promise<CreateUploadResult>;
  verifyObject(input: VerifyObjectInput): Promise<VerifiedObject>;
  deleteObject(storageKey: string): Promise<void>;
}

export class MockMarketplaceDocumentStore implements MarketplaceDocumentStore {
  private allowedMimeTypes = ["application/pdf", "image/jpeg", "image/png"];
  private maxSizeBytes = 10 * 1024 * 1024; // 10 MB

  public async createUpload(input: CreateUploadInput): Promise<CreateUploadResult> {
    // Validate file metadata rules
    if (!this.allowedMimeTypes.includes(input.mimeType)) {
      throw new Error(`Unsupported MIME type: '${input.mimeType}'`);
    }
    if (input.sizeBytes > this.maxSizeBytes) {
      throw new Error("File exceeds maximum limit of 10 MB");
    }
    if (!/^[a-f0-9]{64}$/i.test(input.contentHash)) {
      throw new Error("Invalid SHA-256 hash format");
    }

    const uuid = crypto.randomUUID();
    const storageKey = `marketplace/uploads/${input.tenantId}/${input.applicationId}/${uuid}-${input.filename}`;
    const uploadUrl = `http://localhost:8080/mock-upload?key=${encodeURIComponent(storageKey)}`;

    return { storageKey, uploadUrl };
  }

  public async verifyObject(input: VerifyObjectInput): Promise<VerifiedObject> {
    // Mock virus scan simulation based on hash rules
    // E.g., if hash starts with 'f00', simulate a failed scan for testing
    const scanStatus = input.expectedHash.startsWith("0000") ? "failed" : "passed";

    return {
      isValid: true,
      scanStatus
    };
  }

  public async deleteObject(_storageKey: string): Promise<void> {
    // Mock deletion success
    return;
  }
}
