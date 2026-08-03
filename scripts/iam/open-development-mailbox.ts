import { spawn } from "node:child_process";
import { Pool } from "pg";
import { loadConfig } from "@govos/configuration";
import {
  DevelopmentMailbox,
  type DevelopmentNotificationPayload,
} from "@govos/infrastructure";

const MAILBOX_ID_PATTERN = /^[a-zA-Z0-9-]{1,128}$/;
const INVITATION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TASK_TYPE = "govos.notification.invitation.send";

export interface MailboxEnvironment {
  NODE_ENV?: string;
  DEV_MAILBOX_ENABLED?: string;
  GOVOS_NOTIFICATION_PROVIDER?: string;
  CI?: string;
}

export interface MailboxReader {
  view(id: string): Promise<{
    notificationId: string;
    tenantId: string;
    deliveryStatus: "received" | "delivered";
  }>;
  open(id: string, encryptionKey: string): Promise<DevelopmentNotificationPayload>;
}

export interface QueryResult<Row> {
  rowCount: number | null;
  rows: Row[];
}

export interface MailboxMappingDatabase {
  query<Row>(text: string, values: readonly unknown[]): Promise<QueryResult<Row>>;
}

export type BrowserLauncher = (activationUrl: string) => Promise<void>;

interface MappingRow {
  task_status: string;
  invitation_status: string;
  membership_status: string;
}

export function parseMailboxItemId(args: readonly string[]): string {
  if (args.length !== 2 || args[0] !== "--mailbox-id" || !args[1]) {
    throw new Error("Exactly one --mailbox-id value is required");
  }
  const id = args[1];
  if (!MAILBOX_ID_PATTERN.test(id) || /[*?\[\]{}]/.test(id)) {
    throw new Error("Mailbox item ID is invalid; wildcard operations are prohibited");
  }
  return id;
}

export function assertDevelopmentMailboxEnvironment(
  env: MailboxEnvironment,
): void {
  if (
    env.NODE_ENV !== "development" ||
    env.DEV_MAILBOX_ENABLED !== "true" ||
    env.GOVOS_NOTIFICATION_PROVIDER !== "development"
  ) {
    throw new Error("Owner-local development mailbox access is disabled");
  }
  if (env.CI && env.CI.toLowerCase() !== "false") {
    throw new Error("Owner-local development mailbox access is unavailable in CI");
  }
}

function assertLoopbackActivationUrl(value: string): URL {
  const url = new URL(value);
  const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
  const hashQueryIndex = url.hash.indexOf("?");
  const hashParameters =
    hashQueryIndex >= 0
      ? new URLSearchParams(url.hash.slice(hashQueryIndex + 1))
      : new URLSearchParams();
  const hasInvitationToken =
    Boolean(url.searchParams.get("token")) ||
    Boolean(hashParameters.get("token"));
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !loopbackHosts.has(url.hostname) ||
    url.username ||
    url.password ||
    !hasInvitationToken
  ) {
    throw new Error("Invitation activation target is not an approved local URL");
  }
  return url;
}

export async function openDevelopmentMailboxItem(input: {
  mailboxId: string;
  environment: MailboxEnvironment;
  encryptionKey: string;
  mailbox: MailboxReader;
  database: MailboxMappingDatabase;
  launchBrowser: BrowserLauncher;
}): Promise<void> {
  assertDevelopmentMailboxEnvironment(input.environment);
  if (!MAILBOX_ID_PATTERN.test(input.mailboxId)) {
    throw new Error("Mailbox item ID is invalid");
  }
  if (!/^[a-fA-F0-9]{64}$/.test(input.encryptionKey)) {
    throw new Error("Development mailbox encryption key is unavailable");
  }

  let payload: DevelopmentNotificationPayload | undefined;
  try {
    const safeItem = await input.mailbox.view(input.mailboxId);
    if (
      safeItem.notificationId !== input.mailboxId ||
      safeItem.deliveryStatus !== "received"
    ) {
      throw new Error("Mailbox item is not in the required received state");
    }

    payload = await input.mailbox.open(input.mailboxId, input.encryptionKey);
    if (
      !INVITATION_ID_PATTERN.test(payload.invitationId) ||
      !payload.recipientEmail ||
      !payload.activationUrl
    ) {
      throw new Error("Mailbox invitation metadata is invalid");
    }
    const activationUrl = assertLoopbackActivationUrl(payload.activationUrl);

    const mapping = await input.database.query<MappingRow>(
      `SELECT te.status AS task_status,
              i.status AS invitation_status,
              m.status AS membership_status
         FROM task_execution te
         JOIN user_invitation i
           ON i.tenant_id=te.tenant_id AND i.token_hash=te.payload_hash
         JOIN user_account u
           ON u.tenant_id=i.tenant_id AND u.email=i.email_normalized
         JOIN membership m
           ON m.tenant_id=u.tenant_id AND m.user_id=u.id
         JOIN role r
           ON r.id=m.role_id AND r.tenant_id=m.tenant_id
        WHERE te.task_id=$1
          AND te.task_type=$2
          AND te.tenant_id=$3
          AND i.id=$4
          AND i.email_normalized=LOWER($5)
          AND i.invitation_type='tenant_admin_activation'
          AND m.organization_id IS NULL
          AND m.department_id IS NULL
          AND i.role_id=m.role_id`,
      [
        input.mailboxId,
        TASK_TYPE,
        safeItem.tenantId,
        payload.invitationId,
        payload.recipientEmail,
      ],
    );
    if (mapping.rowCount !== 1 || mapping.rows.length !== 1) {
      throw new Error("Mailbox invitation mapping integrity check failed");
    }
    const state = mapping.rows[0];
    if (
      !state ||
      state.task_status !== "completed" ||
      state.invitation_status !== "pending" ||
      state.membership_status !== "invited"
    ) {
      throw new Error("Mailbox invitation is not in the required pending state");
    }

    await input.launchBrowser(activationUrl.href);
  } finally {
    if (payload) {
      payload.activationUrl = "";
      payload.recipientEmail = "";
      payload.invitationId = "";
      payload.name = undefined;
      payload.expiresAt = undefined;
    }
    payload = undefined;
  }
}

export async function launchDefaultBrowser(activationUrl: string): Promise<void> {
  const command =
    process.platform === "win32"
      ? "rundll32.exe"
      : process.platform === "darwin"
        ? "open"
        : "xdg-open";
  const args =
    process.platform === "win32"
      ? ["url.dll,FileProtocolHandler", activationUrl]
      : [activationUrl];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      detached: true,
      shell: false,
      stdio: "ignore",
      windowsHide: true,
    });
    child.once("error", () => reject(new Error("Default browser could not be opened")));
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

async function main(): Promise<void> {
  const mailboxId = parseMailboxItemId(process.argv.slice(2));
  const config = loadConfig();
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!encryptionKey) throw new Error("Development mailbox encryption key is unavailable");
  const pool = new Pool({ connectionString: config.database.DATABASE_URL });
  try {
    await openDevelopmentMailboxItem({
      mailboxId,
      environment: process.env,
      encryptionKey,
      mailbox: new DevelopmentMailbox(),
      database: pool,
      launchBrowser: launchDefaultBrowser,
    });
    process.stdout.write("Invitation opened in the default browser.\n");
  } finally {
    await pool.end();
  }
}

if (process.argv[1]?.replaceAll("\\", "/").endsWith("/scripts/iam/open-development-mailbox.ts")) {
  main().catch(() => {
    process.stderr.write("Development mailbox opener failed.\n");
    process.exitCode = 1;
  });
}
