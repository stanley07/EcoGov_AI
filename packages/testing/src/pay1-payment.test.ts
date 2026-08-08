import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { PaystackPaymentProvider } from "@govos/core";

const secret = ["sk", "test", "abcdefghijklmnopqrstuvwxyz"].join("_");
const response = (data: any, ok = true, status = 200) => ({ ok, status, json: async () => ({ status: ok, data }) }) as Response;

describe("PAY-1 Paystack provider", () => {
  it("accepts a test key in test mode", () => expect(() => new PaystackPaymentProvider(secret, "test", vi.fn() as any)).not.toThrow());
  it("rejects a live key in test mode", () => expect(() => new PaystackPaymentProvider("sk_live_value", "test", vi.fn() as any)).toThrow());
  it("accepts a live key in live mode", () => expect(() => new PaystackPaymentProvider("sk_live_value", "live", vi.fn() as any)).not.toThrow());
  it("rejects a test key in live mode", () => expect(() => new PaystackPaymentProvider(secret, "live", vi.fn() as any)).toThrow());
  it("identifies itself as paystack", () => expect(new PaystackPaymentProvider(secret, "test", vi.fn() as any).name).toBe("paystack"));
  it("retains the configured environment", () => expect(new PaystackPaymentProvider(secret, "test", vi.fn() as any).environment).toBe("test"));
  it("accepts a valid HMAC-SHA512 signature", () => { const p=new PaystackPaymentProvider(secret,"test",vi.fn() as any); const b=Buffer.from('{"event":"charge.success"}'); const s=crypto.createHmac("sha512",secret).update(b).digest("hex"); expect(p.verifyWebhookSignature(b,s)).toBe(true); });
  it("rejects a modified webhook body", () => { const p=new PaystackPaymentProvider(secret,"test",vi.fn() as any); const s=crypto.createHmac("sha512",secret).update("a").digest("hex"); expect(p.verifyWebhookSignature(Buffer.from("b"),s)).toBe(false); });
  it("rejects an empty signature", () => expect(new PaystackPaymentProvider(secret,"test",vi.fn() as any).verifyWebhookSignature(Buffer.from("a"),"")).toBe(false));
  it("rejects malformed signatures", () => expect(new PaystackPaymentProvider(secret,"test",vi.fn() as any).verifyWebhookSignature(Buffer.from("a"),"xyz")).toBe(false));
  it("initializes with server values", async () => { const f=vi.fn().mockResolvedValue(response({reference:"r",authorization_url:"https://checkout.paystack.com/x",access_code:"a"})); const p=new PaystackPaymentProvider(secret,"test",f as any); const result=await p.initialize({email:"a@example.com",amountMinor:10000,currency:"NGN",reference:"r",callbackUrl:"https://example.com/c",metadata:{invoiceId:"i"}}); expect(result.authorizationUrl).toContain("paystack.com"); expect(JSON.parse(f.mock.calls[0][1].body).amount).toBe(10000); });
  it("sends bearer authorization without exposing it in payload", async () => { const f=vi.fn().mockResolvedValue(response({reference:"r",authorization_url:"u"})); const p=new PaystackPaymentProvider(secret,"test",f as any); await p.initialize({email:"a@b.co",amountMinor:1,currency:"NGN",reference:"r",callbackUrl:"https://x.test",metadata:{}}); expect(f.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${secret}`); expect(f.mock.calls[0][1].body).not.toContain(secret); });
  it("maps successful verification to paid", async () => { const p=new PaystackPaymentProvider(secret,"test",vi.fn().mockResolvedValue(response({reference:"r",id:1,status:"success",amount:100,currency:"ngn"})) as any); expect((await p.verify("r")).status).toBe("paid"); });
  it("maps abandoned verification to cancelled", async () => { const p=new PaystackPaymentProvider(secret,"test",vi.fn().mockResolvedValue(response({reference:"r",id:1,status:"abandoned",amount:100,currency:"NGN"})) as any); expect((await p.verify("r")).status).toBe("cancelled"); });
  it("maps failed verification to failed", async () => { const p=new PaystackPaymentProvider(secret,"test",vi.fn().mockResolvedValue(response({reference:"r",id:1,status:"failed",amount:100,currency:"NGN"})) as any); expect((await p.verify("r")).status).toBe("failed"); });
  it("maps nonterminal verification to pending", async () => { const p=new PaystackPaymentProvider(secret,"test",vi.fn().mockResolvedValue(response({reference:"r",id:1,status:"ongoing",amount:100,currency:"NGN"})) as any); expect((await p.verify("r")).status).toBe("pending"); });
  it("normalizes verified currency and transaction identity", async () => { const p=new PaystackPaymentProvider(secret,"test",vi.fn().mockResolvedValue(response({reference:"r",id:42,status:"success",amount:100,currency:"ngn",channel:"card"})) as any); const v=await p.verify("r"); expect(v).toMatchObject({currency:"NGN",transactionId:"42",channel:"card"}); });
  it("redacts provider failure details", async () => { const p=new PaystackPaymentProvider(secret,"test",vi.fn().mockResolvedValue(response({},false,401)) as any); await expect(p.verify("r")).rejects.toThrow("PAYSTACK_REQUEST_FAILED:401"); });
});
