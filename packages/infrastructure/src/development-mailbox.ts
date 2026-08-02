import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface DevelopmentNotificationPayload {
  invitationId: string;
  recipientEmail: string;
  activationUrl: string;
  expiresAt?: string;
  name?: string;
}

export interface DevelopmentMailboxRecord {
  notificationId: string;
  createdAt: string;
  tenantId: string;
  notificationType: string;
  recipientEmail: string;
  subject: string;
  body: string;
  deliveryStatus: "received" | "delivered";
  protectedPayload: {
    iv: string;
    authTag: string;
    ciphertext: string;
  };
}

function mailboxRoot(): string {
  return path.resolve(process.env.DEV_MAILBOX_PATH || "runtime/dev-mailbox");
}

function assertId(id: string): void {
  if (!/^[a-zA-Z0-9-]{1,128}$/.test(id)) throw new Error("Invalid notification identifier");
}

function keyBytes(keyHex: string): Buffer {
  if (!/^[a-fA-F0-9]{64}$/.test(keyHex)) throw new Error("A 64-character hexadecimal ENCRYPTION_KEY is required");
  return Buffer.from(keyHex, "hex");
}

function protect(payload: DevelopmentNotificationPayload, keyHex: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", keyBytes(keyHex), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(payload), "utf8"), cipher.final()]);
  return { iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64"), ciphertext: ciphertext.toString("base64") };
}

function unprotect(record: DevelopmentMailboxRecord, keyHex: string): DevelopmentNotificationPayload {
  const envelope = record.protectedPayload;
  const decipher = crypto.createDecipheriv("aes-256-gcm", keyBytes(keyHex), Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext, "base64")), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as DevelopmentNotificationPayload;
}

async function ensureRoot(): Promise<string> {
  const root = mailboxRoot();
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  await fs.chmod(root, 0o700).catch(() => undefined);
  return root;
}

export class DevelopmentMailbox {
  async deliver(input: {
    notificationId: string;
    tenantId: string;
    notificationType: string;
    subject: string;
    body: string;
    payload: DevelopmentNotificationPayload;
    encryptionKey: string;
  }): Promise<DevelopmentMailboxRecord> {
    if (process.env.GOVOS_NOTIFICATION_PROVIDER !== "development" || process.env.NODE_ENV !== "development") {
      throw new Error("Development notification provider is disabled");
    }
    assertId(input.notificationId);
    const root = await ensureRoot();
    const record: DevelopmentMailboxRecord = {
      notificationId: input.notificationId, createdAt: new Date().toISOString(), tenantId: input.tenantId,
      notificationType: input.notificationType, recipientEmail: input.payload.recipientEmail,
      subject: input.subject, body: input.body, deliveryStatus: "received",
      protectedPayload: protect(input.payload, input.encryptionKey),
    };
    const target = path.join(root, `${input.notificationId}.json`);
    let handle;
    try {
      handle = await fs.open(target, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return this.read(input.notificationId);
      throw error;
    }
    try { await handle.writeFile(JSON.stringify(record, null, 2), "utf8"); } finally { await handle.close(); }
    await fs.chmod(target, 0o600).catch(() => undefined);
    return record;
  }

  async list(): Promise<Omit<DevelopmentMailboxRecord, "protectedPayload">[]> {
    const root = await ensureRoot();
    const files = (await fs.readdir(root)).filter((name) => name.endsWith(".json"));
    const records = await Promise.all(files.map((name) => this.read(name.slice(0, -5))));
    return records.map(({ protectedPayload: _protectedPayload, ...safe }) => safe).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async read(id: string): Promise<DevelopmentMailboxRecord> {
    assertId(id);
    const content = await fs.readFile(path.join(await ensureRoot(), `${id}.json`), "utf8");
    return JSON.parse(content) as DevelopmentMailboxRecord;
  }

  async view(id: string): Promise<Omit<DevelopmentMailboxRecord, "protectedPayload">> {
    const { protectedPayload: _protectedPayload, ...safe } = await this.read(id);
    return safe;
  }

  async open(id: string, encryptionKey: string): Promise<DevelopmentNotificationPayload> {
    return unprotect(await this.read(id), encryptionKey);
  }

  async markDelivered(id: string): Promise<void> {
    const record = await this.read(id);
    record.deliveryStatus = "delivered";
    await fs.writeFile(path.join(await ensureRoot(), `${id}.json`), JSON.stringify(record, null, 2), { encoding: "utf8", mode: 0o600 });
  }

  async delete(id: string): Promise<void> {
    assertId(id);
    await fs.unlink(path.join(await ensureRoot(), `${id}.json`));
  }
}
