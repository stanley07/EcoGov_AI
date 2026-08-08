import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { MarketplacePaymentReconciliationService, PaystackRegistrationPaymentService, type PaymentProvider } from "@govos/core";
import { createApp } from "@govos/api/app";

const rawWebhook = Buffer.from(JSON.stringify({ event: "charge.success", data: { id: 42, reference: "GOVOS-test" } }));
const payloadHash = crypto.createHash("sha256").update(rawWebhook).digest("hex");

describe("PAY-2 Critical remediation", () => {
  it("rejects an invalid Paystack signature before any persistence or verification", async () => {
    const pool={query:vi.fn()} as any;
    const provider: PaymentProvider={name:"paystack",environment:"test",initialize:vi.fn() as any,verify:vi.fn() as any,verifyWebhookSignature:()=>false};
    await expect(new PaystackRegistrationPaymentService(pool,provider,"https://example.test/callback").processWebhook(rawWebhook,"invalid")).rejects.toThrow("UNAUTHORIZED_SIGNATURE");
    expect(pool.query).not.toHaveBeenCalled(); expect(provider.verify).not.toHaveBeenCalled();
  });

  it("keeps demo settlement and Paystack-through-legacy webhook unavailable in production", async () => {
    const previous = { appEnv: process.env.APP_ENV, enabled: process.env.PAYMENTS_DEMO_ENABLED, token: process.env.PAYMENTS_DEMO_TOKEN };
    process.env.APP_ENV="production"; process.env.PAYMENTS_DEMO_ENABLED="true"; process.env.PAYMENTS_DEMO_TOKEN="configured-but-forbidden";
    const pool={query:vi.fn(async()=>{throw new Error("financial query must not run");})} as any;
    const config={appEnv:"production",database:{DATABASE_URL:"postgres://unused"},observability:{LOG_LEVEL:"error"},ai:{AI_PROVIDER:"deterministic",GEMINI_MODEL_ID:"test"},api:{PORT:8080},worker:{WORKER_PORT:8081,WORKER_AUTH_MODE:"local"}} as any;
    const app=createApp(config,pool);
    try {
      const demo=await app.inject({method:"POST",url:"/marketplace/payments/demo-complete",headers:{"x-demo-payment-token":"configured-but-forbidden"},payload:{checkoutSessionId:"ref"}});
      expect(demo.statusCode).toBe(404);
      const legacy=await app.inject({method:"POST",url:"/marketplace/payments/webhooks/paystack",payload:{}});
      expect(legacy.statusCode).not.toBe(200);
      expect(pool.query).not.toHaveBeenCalled();
    } finally {
      await app.close();
      previous.appEnv===undefined?delete process.env.APP_ENV:process.env.APP_ENV=previous.appEnv;
      previous.enabled===undefined?delete process.env.PAYMENTS_DEMO_ENABLED:process.env.PAYMENTS_DEMO_ENABLED=previous.enabled;
      previous.token===undefined?delete process.env.PAYMENTS_DEMO_TOKEN:process.env.PAYMENTS_DEMO_TOKEN=previous.token;
    }
  });

  it("reclaims a failed Paystack event instead of acknowledging it as terminal duplicate", async () => {
    let insertCount = 0; let verifyCount = 0; let failedUpdates = 0;
    const pool = {
      query: vi.fn(async (sql: string, params?: any[]) => {
        if (sql.includes("INSERT INTO marketplace_payment_event")) return { rows: insertCount++ === 0 ? [{ id: "event" }] : [] };
        if (sql.includes("SET processing_status='processing'")) {
          expect(params).toEqual(["paystack:42:charge.success", payloadHash]);
          return { rows: [{ id: "event" }] };
        }
        if (sql.includes("SET processing_status='failed'")) { failedUpdates++; return { rows: [] }; }
        throw new Error(`Unexpected SQL: ${sql}`);
      }),
    } as any;
    const provider: PaymentProvider = {
      name: "paystack", environment: "test", initialize: vi.fn() as any,
      verifyWebhookSignature: () => true,
      verify: async () => { verifyCount++; throw new Error("PAYSTACK_REQUEST_FAILED:503"); },
    };
    const service = new PaystackRegistrationPaymentService(pool, provider, "https://example.test/callback");
    await expect(service.processWebhook(rawWebhook, "signature")).rejects.toThrow("PAYSTACK_REQUEST_FAILED:503");
    await expect(service.processWebhook(rawWebhook, "signature")).rejects.toThrow("PAYSTACK_REQUEST_FAILED:503");
    expect(verifyCount).toBe(2);
    expect(failedUpdates).toBe(2);
  });

  it("acknowledges only terminal processed Paystack events as duplicates", async () => {
    const pool = { query: vi.fn(async (sql: string) => {
      if (sql.includes("INSERT INTO marketplace_payment_event")) return { rows: [] };
      if (sql.includes("SET processing_status='processing'")) return { rows: [] };
      if (sql.includes("SELECT processing_status")) return { rows: [{ processing_status: "processed" }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    }) } as any;
    const provider: PaymentProvider = { name:"paystack",environment:"test",initialize:vi.fn() as any,verify:vi.fn() as any,verifyWebhookSignature:()=>true };
    const result = await new PaystackRegistrationPaymentService(pool, provider, "https://example.test/callback").processWebhook(rawWebhook, "signature");
    expect(result).toEqual({ success: true, deduplicated: true });
    expect(provider.verify).not.toHaveBeenCalled();
  });

  it("does not treat an in-progress duplicate as successful settlement", async () => {
    const pool = { query: vi.fn(async (sql: string) => {
      if (sql.includes("INSERT INTO marketplace_payment_event") || sql.includes("SET processing_status='processing'")) return { rows: [] };
      if (sql.includes("SELECT processing_status")) return { rows: [{ processing_status: "processing" }] };
      throw new Error(`Unexpected SQL: ${sql}`);
    }) } as any;
    const provider: PaymentProvider = { name:"paystack",environment:"test",initialize:vi.fn() as any,verify:vi.fn() as any,verifyWebhookSignature:()=>true };
    await expect(new PaystackRegistrationPaymentService(pool, provider, "https://example.test/callback").processWebhook(rawWebhook, "signature")).rejects.toThrow("WEBHOOK_RETRY_PENDING");
  });

  it("binds a legacy completion event to the stored provider", async () => {
    const queries: Array<{sql:string;params:any[]}> = [];
    const pool = { query: vi.fn(async (sql:string, params:any[]) => {
      queries.push({sql,params});
      if (sql.includes("SELECT id, processing_status")) return { rows: [] };
      if (sql.includes("INSERT INTO marketplace_payment_event")) return { rows: [] };
      if (sql.includes("SELECT * FROM marketplace_payment")) return { rows: [] };
      if (sql.includes("UPDATE marketplace_payment_event")) return { rows: [] };
      return { rows: [] };
    }) } as any;
    const payload = { id:"evt",type:"checkout.session.completed",checkout_reference:"ref",amount:100,currency:"NGN" };
    const raw=JSON.stringify(payload); const secret="legacy-test-secret"; const signature=crypto.createHmac("sha256",secret).update(raw).digest("hex");
    await expect(new MarketplacePaymentReconciliationService(pool).processWebhook("stripe",raw,signature,secret,payload)).rejects.toThrow("Payment not found");
    const lookup=queries.find(query=>query.sql.includes("SELECT * FROM marketplace_payment"));
    expect(lookup?.sql).toContain("provider = $2");
    expect(lookup?.params).toEqual(["ref","stripe"]);
  });
});
