import { promises as dns } from "node:dns";
import { isIP } from "node:net";
import { URL } from "node:url";

export interface ValidatedWebhookTarget {
  url: URL;
  address: string;
  family: 4 | 6;
}

export async function validateWebhookUrl(
  value: string,
): Promise<ValidatedWebhookTarget> {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Webhook target must use HTTPS");
  const records = await dns.lookup(url.hostname, { all: true, verbatim: true });
  if (!records.length) throw new Error("Webhook host has no addresses");
  for (const record of records)
    if (isForbiddenAddress(record.address))
      throw new Error("Webhook target is forbidden");
  const selected = records[0]!;
  return { url, address: selected.address, family: selected.family as 4 | 6 };
}

export function isForbiddenAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  if (!isIP(normalized)) return true;
  if (normalized.includes(":")) {
    return (
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe8") ||
      normalized.startsWith("fe9") ||
      normalized.startsWith("fea") ||
      normalized.startsWith("feb") ||
      normalized.startsWith("ff") ||
      normalized.startsWith("2001:db8:") ||
      normalized.startsWith("::ffff:")
    );
  }
  const [a, b, c] = normalized.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b! >= 64 && b! <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b! >= 16 && b! <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a! >= 224 ||
    (a === 169 && b === 254 && c === 169)
  );
}
