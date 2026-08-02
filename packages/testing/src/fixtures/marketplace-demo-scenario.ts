import { Pool } from "pg";
import crypto from "node:crypto";
import { AccessTokenService } from "@govos/core";

export interface DemoSeedResult {
  tenantId: string;
  subcontractors: {
    appId: string;
    profileId?: string;
    accessToken: string;
    businessName: string;
  }[];
  lgas: { id: string; name: string }[];
  clusters: { id: string; name: string; lgaId: string }[];
}

export async function buildDemoScenario(pool: Pool, targetTenantSlug: string): Promise<DemoSeedResult> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. Resolve or Create Tenant
    let tenantId: string;
    const tenantRes = await client.query("SELECT id FROM tenant WHERE slug = $1", [targetTenantSlug]);
    if (tenantRes.rows.length > 0) {
      tenantId = tenantRes.rows[0].id;
      // Clean up previous runs for this tenant to allow idempotent reruns
      await cleanDemoTenantData(client, tenantId);
    } else {
      tenantId = crypto.randomUUID();
      await client.query(
        `INSERT INTO tenant (id, name, slug, type, status) 
         VALUES ($1, $3, $2, 'ministry', 'active')`,
        [tenantId, targetTenantSlug, "Anambra State Ministry of Environment"]
      );
    }

    // 2. Resolve default user account and organization for facility references
    let orgId: string;
    const orgRes = await client.query("SELECT id FROM organization WHERE tenant_id = $1 LIMIT 1", [tenantId]);
    if (orgRes.rows.length > 0) {
      orgId = orgRes.rows[0].id;
    } else {
      orgId = crypto.randomUUID();
      await client.query(
        `INSERT INTO organization (id, tenant_id, name, status)
         VALUES ($1, $2, $3, 'active')`,
        [orgId, tenantId, "Anambra Environment Directorate"]
      );
    }

    let officerId: string;
    const userRes = await client.query("SELECT id FROM user_account WHERE tenant_id = $1 LIMIT 1", [tenantId]);
    if (userRes.rows.length > 0) {
      officerId = userRes.rows[0].id;
    } else {
      officerId = crypto.randomUUID();
      await client.query(
        `INSERT INTO user_account (id, tenant_id, email, password_hash, status, first_name, last_name)
         VALUES ($1, $2, $3, 'hashed', 'active', 'Anambra', 'Officer')`,
        [officerId, tenantId, "officer@anambra.gov.ng"]
      );
    }

    // 3. Seed LGAs
    const lgas = [
      { id: crypto.randomUUID(), name: "Awka South" },
      { id: crypto.randomUUID(), name: "Onitsha South" },
      { id: crypto.randomUUID(), name: "Nnewi North" }
    ];

    for (const lga of lgas) {
      await client.query(
        "INSERT INTO local_government_area (id, tenant_id, name, state_name) VALUES ($1, $2, $3, 'Anambra')",
        [lga.id, tenantId, lga.name]
      );
    }

    // 4. Seed Clusters
    const clusters = [
      { id: crypto.randomUUID(), name: "Awka Central", lgaId: lgas[0].id },
      { id: crypto.randomUUID(), name: "Awka North-East", lgaId: lgas[0].id },
      { id: crypto.randomUUID(), name: "Onitsha Market", lgaId: lgas[1].id },
      { id: crypto.randomUUID(), name: "Onitsha Port", lgaId: lgas[1].id },
      { id: crypto.randomUUID(), name: "Nnewi Industrial", lgaId: lgas[2].id },
      { id: crypto.randomUUID(), name: "Nnewi Commercial", lgaId: lgas[2].id }
    ];

    for (const c of clusters) {
      await client.query(
        "INSERT INTO cluster (id, tenant_id, name, region_details) VALUES ($1, $2, $3, $4)",
        [c.id, tenantId, c.name, `Covers zones in LGA ${c.lgaId}`]
      );
    }

    const seededSubs: DemoSeedResult["subcontractors"] = [];

    // Helper to log application events
    const logEvent = async (appId: string, type: string, key: string, time: Date) => {
      await client.query(
        `INSERT INTO subcontractor_application_event (
           tenant_id, application_id, event_type, event_key, actor_type, new_state, correlation_id, created_at
         ) VALUES ($1, $2, $3, $4, 'system', 'backfilled', $5, $6)`,
        [tenantId, appId, type, key, crypto.randomUUID(), time]
      );
    };

    // Helper to insert subcontractor application with all required fields
    const insertApp = async (appId: string, name: string, reg: string, tax: string, email: string, hash: string, status: string) => {
      await client.query(
        `INSERT INTO subcontractor_application (
           id, tenant_id, business_name, registration_number, tax_identifier, contact_email, contact_phone, operating_address, experience_years, license_type, access_token_hash, status
         ) VALUES ($1, $2, $3, $4, $5, $6, '0801122', 'Awka, Anambra', 5, 'environmental-consultant', $7, $8)`,
        [appId, tenantId, name, reg, tax, email, hash, status]
      );
    };

    // Helper to insert AI execution and screening result
    const insertScreening = async (appId: string, recommendation: string, score: number) => {
      const executionId = crypto.randomUUID();
      await client.query(`
        INSERT INTO ai_execution (
          id, tenant_id, agent_name, model_provider, model_name,
          prompt_template_version, input_hash, execution_status, current_state, validation_status, started_at, actor_type
        ) VALUES ($1, $2, 'screening-agent', 'gemini', 'gemini-1.5-pro', '1.0.0', 'hash', 'succeeded', 'completed', 'valid', NOW(), 'system')
      `, [executionId, tenantId]);

      const resultId = crypto.randomUUID();
      await client.query(`
        INSERT INTO subcontractor_screening_result (
          id, tenant_id, application_id, ai_execution_id, screening_policy_version,
          input_snapshot_hash, screening_status, application_version, recommendation, score, criteria, model_version, risk_flags
        ) VALUES ($1, $2, $3, $4, '1.0.0', 'hash', 'completed', 1, $5, $6, '[]'::jsonb, 'gemini-1.5-pro', ARRAY['low-experience'])
      `, [resultId, tenantId, appId, executionId, recommendation, score]);
    };

    // --- App 1: Draft Funnel State ---
    const app1Id = crypto.randomUUID();
    const token1 = "token-draft-demo-12345";
    const tokenHash1 = AccessTokenService.hashToken(token1);
    await insertApp(app1Id, "Awka Waste Collectors", "REG-AWKA-01", "TAX-AWKA-01", "awka@waste.ng", tokenHash1, "draft");
    await logEvent(app1Id, "application.created", `application.created:${app1Id}`, new Date(Date.now() - 10 * 24 * 60 * 60 * 1000));
    seededSubs.push({ appId: app1Id, accessToken: token1, businessName: "Awka Waste Collectors" });

    // --- App 2: Screening Queue ---
    const app2Id = crypto.randomUUID();
    const token2 = "token-queue-demo-12345";
    const tokenHash2 = AccessTokenService.hashToken(token2);
    await insertApp(app2Id, "Onitsha Sanitation Ltd", "REG-ONIT-02", "TAX-ONIT-02", "onitsha@san.ng", tokenHash2, "screening_queued");
    const time2 = new Date(Date.now() - 9 * 24 * 60 * 60 * 1000);
    await logEvent(app2Id, "application.created", `application.created:${app2Id}`, time2);
    await logEvent(app2Id, "application.submitted", `application.submitted:${app2Id}`, new Date(time2.getTime() + 10000));
    await logEvent(app2Id, "screening.started", `screening.started:${crypto.randomUUID()}`, new Date(time2.getTime() + 20000));
    seededSubs.push({ appId: app2Id, accessToken: token2, businessName: "Onitsha Sanitation Ltd" });

    // --- App 3: Screening Failed (Operational failure with retry) ---
    const app3Id = crypto.randomUUID();
    const token3 = "token-fail-demo-12345";
    const tokenHash3 = AccessTokenService.hashToken(token3);
    await insertApp(app3Id, "Nnewi Recycling", "REG-NNEWI-03", "TAX-NNEWI-03", "nnewi@recycle.ng", tokenHash3, "screening_failed");
    const time3 = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    await logEvent(app3Id, "application.created", `application.created:${app3Id}`, time3);
    await logEvent(app3Id, "application.submitted", `application.submitted:${app3Id}`, new Date(time3.getTime() + 10000));
    await logEvent(app3Id, "screening.started", `screening.started:${crypto.randomUUID()}`, new Date(time3.getTime() + 20000));
    await logEvent(app3Id, "screening.completed", `screening.completed:${crypto.randomUUID()}`, new Date(time3.getTime() + 30000));
    await logEvent(app3Id, "screening.started", `screening.started:${crypto.randomUUID()}`, new Date(time3.getTime() + 40000)); // retry screening
    seededSubs.push({ appId: app3Id, accessToken: token3, businessName: "Nnewi Recycling" });

    // --- App 4: Awaiting Officer Review ---
    const app4Id = crypto.randomUUID();
    const token4 = "token-review-demo-12345";
    const tokenHash4 = AccessTokenService.hashToken(token4);
    await insertApp(app4Id, "Anambra Clean Team", "REG-ANAM-04", "TAX-ANAM-04", "clean@anam.ng", tokenHash4, "awaiting_officer_review");
    const time4 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    await logEvent(app4Id, "application.created", `application.created:${app4Id}`, time4);
    await logEvent(app4Id, "application.submitted", `application.submitted:${app4Id}`, new Date(time4.getTime() + 15000));
    await logEvent(app4Id, "screening.started", `screening.started:${crypto.randomUUID()}`, new Date(time4.getTime() + 20000));
    await logEvent(app4Id, "screening.completed", `screening.completed:${crypto.randomUUID()}`, new Date(time4.getTime() + 40000));
    await insertScreening(app4Id, "high_risk", 35.00);
    seededSubs.push({ appId: app4Id, accessToken: token4, businessName: "Anambra Clean Team" });

    // --- App 5: Rejected ---
    const app5Id = crypto.randomUUID();
    const token5 = "token-reject-demo-12345";
    const tokenHash5 = AccessTokenService.hashToken(token5);
    await insertApp(app5Id, "Nnewi Toxic Handlers", "REG-NNEWI-05", "TAX-NNEWI-05", "toxic@nnewi.ng", tokenHash5, "rejected");
    const time5 = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);
    await logEvent(app5Id, "application.created", `application.created:${app5Id}`, time5);
    await logEvent(app5Id, "application.submitted", `application.submitted:${app5Id}`, new Date(time5.getTime() + 15000));
    await logEvent(app5Id, "screening.started", `screening.started:${crypto.randomUUID()}`, new Date(time5.getTime() + 20000));
    await logEvent(app5Id, "screening.completed", `screening.completed:${crypto.randomUUID()}`, new Date(time5.getTime() + 40000));
    await logEvent(app5Id, "officer.rejected", `officer.rejected:${app5Id}`, new Date(time5.getTime() + 3 * 3600 * 1000));
    await insertScreening(app5Id, "high_risk", 15.00);
    seededSubs.push({ appId: app5Id, accessToken: token5, businessName: "Nnewi Toxic Handlers" });

    // --- App 6: Approved Unpaid Invoice ---
    const app6Id = crypto.randomUUID();
    const token6 = "token-invoice-demo-12345";
    const tokenHash6 = AccessTokenService.hashToken(token6);
    await insertApp(app6Id, "Awka Environmental Solutions", "REG-AWKA-06", "TAX-AWKA-06", "awka@env.ng", tokenHash6, "approved");
    const time6 = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000);
    await logEvent(app6Id, "application.created", `application.created:${app6Id}`, time6);
    await logEvent(app6Id, "application.submitted", `application.submitted:${app6Id}`, new Date(time6.getTime() + 15000));
    await logEvent(app6Id, "screening.started", `screening.started:${crypto.randomUUID()}`, new Date(time6.getTime() + 20000));
    await logEvent(app6Id, "screening.completed", `screening.completed:${crypto.randomUUID()}`, new Date(time6.getTime() + 40000));
    await logEvent(app6Id, "officer.approved", `officer.approved:${app6Id}`, new Date(time6.getTime() + 1 * 3600 * 1000));
    await logEvent(app6Id, "invoice.created", `invoice.created:${app6Id}`, new Date(time6.getTime() + 1 * 3600 * 1000 + 5000));
    await logEvent(app6Id, "checkout.created", `checkout.created:${app6Id}`, new Date(time6.getTime() + 1 * 3600 * 1000 + 10000));

    await client.query(
      `INSERT INTO marketplace_invoice (id, tenant_id, application_id, invoice_number, billing_period_start, billing_period_end, amount_due_microunits, currency, status)
       VALUES ($1, $2, $3, 'INV-DEMO-06', NOW() - INTERVAL '1 day', NOW() + INTERVAL '1 year', 500000000, 'NGN', 'unpaid')`,
      [crypto.randomUUID(), tenantId, app6Id]
    );
    seededSubs.push({ appId: app6Id, accessToken: token6, businessName: "Awka Environmental Solutions" });

    // --- App 7: Paid & Licensed (No assignment) ---
    const app7Id = crypto.randomUUID();
    const token7 = "token-licence-demo-12345";
    const tokenHash7 = AccessTokenService.hashToken(token7);
    await insertApp(app7Id, "Onitsha Bio-Waste Services", "REG-ONIT-07", "TAX-ONIT-07", "onitsha@bio.ng", tokenHash7, "licence_issued");
    const time7 = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
    await logEvent(app7Id, "application.created", `application.created:${app7Id}`, time7);
    await logEvent(app7Id, "application.submitted", `application.submitted:${app7Id}`, new Date(time7.getTime() + 15000));
    await logEvent(app7Id, "screening.started", `screening.started:${crypto.randomUUID()}`, new Date(time7.getTime() + 20000));
    await logEvent(app7Id, "screening.completed", `screening.completed:${crypto.randomUUID()}`, new Date(time7.getTime() + 40000));
    await logEvent(app7Id, "officer.approved", `officer.approved:${app7Id}`, new Date(time7.getTime() + 1 * 3600 * 1000));
    await logEvent(app7Id, "invoice.created", `invoice.created:${app7Id}`, new Date(time7.getTime() + 1 * 3600 * 1000 + 5000));
    await logEvent(app7Id, "checkout.created", `checkout.created:${app7Id}`, new Date(time7.getTime() + 1 * 3600 * 1000 + 10000));
    await logEvent(app7Id, "payment.confirmed", `payment.confirmed:${app7Id}`, new Date(time7.getTime() + 2 * 3600 * 1000));

    const invoice7Id = crypto.randomUUID();
    await client.query(
      `INSERT INTO marketplace_invoice (id, tenant_id, application_id, invoice_number, billing_period_start, billing_period_end, amount_due_microunits, currency, status)
       VALUES ($1, $2, $3, 'INV-DEMO-07', NOW() - INTERVAL '1 day', NOW() + INTERVAL '1 year', 750000000, 'NGN', 'paid')`,
      [invoice7Id, tenantId, app7Id]
    );

    const payment7Id = crypto.randomUUID();
    await client.query(
      `INSERT INTO marketplace_payment (id, tenant_id, invoice_id, provider, provider_checkout_reference, provider_transaction_reference, amount_paid_microunits, currency, status)
       VALUES ($1, $2, $3, 'stripe', 'cs-ref-07', 'ref-stripe-07', 750000000, 'NGN', 'succeeded')`,
      [payment7Id, tenantId, invoice7Id]
    );

    // Ledger Credit
    await client.query(
      `INSERT INTO marketplace_revenue_ledger (tenant_id, invoice_id, payment_id, entry_reference, amount_microunits, currency, entry_type, occurred_at)
       VALUES ($1, $2, $3, 'ledger-ref-07', 750000000, 'NGN', 'credit', NOW() - INTERVAL '3 days')`,
      [tenantId, invoice7Id, payment7Id]
    );

    const sub7ProfileId = crypto.randomUUID();
    await client.query(
      `INSERT INTO subcontractor_profile (id, tenant_id, application_id, business_name, status, performance_score)
       VALUES ($1, $2, $3, 'Onitsha Bio-Waste Services', 'active', 5.00)`,
      [sub7ProfileId, tenantId, app7Id]
    );

    const licence7Id = crypto.randomUUID();
    await client.query(
      `INSERT INTO subcontractor_licence (id, tenant_id, subcontractor_id, invoice_id, licence_number, verification_code, licence_type, status, issued_at, valid_from, expires_at)
       VALUES ($1, $2, $3, $4, 'LIC-DEMO-07', 'VER-DEMO-07', 'environmental-consultant', 'active', NOW() - INTERVAL '3 days', NOW() - INTERVAL '3 days', NOW() + INTERVAL '1 year')`,
      [licence7Id, tenantId, sub7ProfileId, invoice7Id]
    );
    await logEvent(app7Id, "licence.issued", `licence.issued:${licence7Id}`, new Date(time7.getTime() + 2 * 3600 * 1000 + 5000));
    seededSubs.push({ appId: app7Id, profileId: sub7ProfileId, accessToken: token7, businessName: "Onitsha Bio-Waste Services" });

    // --- App 8: Fully Seseeded, Assigned, 25 Facilities ---
    const app8Id = crypto.randomUUID();
    const token8 = "token-full-demo-12345";
    const tokenHash8 = AccessTokenService.hashToken(token8);
    await insertApp(app8Id, "Awka Green Shield Ltd", "REG-AWKA-08", "TAX-AWKA-08", "greenshield@awka.ng", tokenHash8, "licence_issued");

    const time8 = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    await logEvent(app8Id, "application.created", `application.created:${app8Id}`, time8);
    await logEvent(app8Id, "application.submitted", `application.submitted:${app8Id}`, new Date(time8.getTime() + 15000));
    await logEvent(app8Id, "screening.started", `screening.started:${crypto.randomUUID()}`, new Date(time8.getTime() + 20000));
    await logEvent(app8Id, "screening.completed", `screening.completed:${crypto.randomUUID()}`, new Date(time8.getTime() + 40000));
    await logEvent(app8Id, "officer.approved", `officer.approved:${app8Id}`, new Date(time8.getTime() + 1 * 3600 * 1000));
    await logEvent(app8Id, "invoice.created", `invoice.created:${app8Id}`, new Date(time8.getTime() + 1 * 3600 * 1000 + 5000));
    await logEvent(app8Id, "checkout.created", `checkout.created:${app8Id}`, new Date(time8.getTime() + 1 * 3600 * 1000 + 10000));
    await logEvent(app8Id, "payment.confirmed", `payment.confirmed:${app8Id}`, new Date(time8.getTime() + 2 * 3600 * 1000));

    const invoice8Id = crypto.randomUUID();
    await client.query(
      `INSERT INTO marketplace_invoice (id, tenant_id, application_id, invoice_number, billing_period_start, billing_period_end, amount_due_microunits, currency, status)
       VALUES ($1, $2, $3, 'INV-DEMO-08', NOW() - INTERVAL '1 day', NOW() + INTERVAL '1 year', 1000000000, 'NGN', 'paid')`,
      [invoice8Id, tenantId, app8Id]
    );

    const payment8Id = crypto.randomUUID();
    await client.query(
      `INSERT INTO marketplace_payment (id, tenant_id, invoice_id, provider, provider_checkout_reference, provider_transaction_reference, amount_paid_microunits, currency, status)
       VALUES ($1, $2, $3, 'stripe', 'cs-ref-08', 'ref-stripe-08', 1000000000, 'NGN', 'succeeded')`,
      [payment8Id, tenantId, invoice8Id]
    );

    await client.query(
      `INSERT INTO marketplace_revenue_ledger (tenant_id, invoice_id, payment_id, entry_reference, amount_microunits, currency, entry_type, occurred_at)
       VALUES ($1, $2, $3, 'ledger-ref-08', 1000000000, 'NGN', 'credit', NOW() - INTERVAL '2 days')`,
      [tenantId, invoice8Id, payment8Id]
    );

    const sub8ProfileId = crypto.randomUUID();
    await client.query(
      `INSERT INTO subcontractor_profile (id, tenant_id, application_id, business_name, status, performance_score)
       VALUES ($1, $2, $3, 'Awka Green Shield Ltd', 'active', 5.00)`,
      [sub8ProfileId, tenantId, app8Id]
    );

    const licence8Id = crypto.randomUUID();
    await client.query(
      `INSERT INTO subcontractor_licence (id, tenant_id, subcontractor_id, invoice_id, licence_number, verification_code, licence_type, status, issued_at, valid_from, expires_at)
       VALUES ($1, $2, $3, $4, 'LIC-DEMO-08', 'VER-DEMO-08', 'environmental-consultant', 'active', NOW() - INTERVAL '2 days', NOW() - INTERVAL '2 days', NOW() + INTERVAL '1 year')`,
      [licence8Id, tenantId, sub8ProfileId, invoice8Id]
    );
    await logEvent(app8Id, "licence.issued", `licence.issued:${licence8Id}`, new Date(time8.getTime() + 2 * 3600 * 1000 + 5000));

    // Active territory assignment in Awka South (LGA)
    const assignment8Id = crypto.randomUUID();
    await client.query(
      `INSERT INTO subcontractor_assignment (id, tenant_id, subcontractor_id, assignment_type, lga_id, starts_at, status, assigned_by)
       VALUES ($1, $2, $3, 'lga', $4, NOW() - INTERVAL '2 days', 'active', $5)`,
      [assignment8Id, tenantId, sub8ProfileId, lgas[0].id, officerId]
    );
    await logEvent(app8Id, "assignment.activated", `assignment.activated:${assignment8Id}`, new Date(time8.getTime() + 2 * 3600 * 1000 + 10000));

    // Let's seed 25 facilities under Awka South
    for (let f = 1; f <= 25; f++) {
      const facilityId = crypto.randomUUID();
      let name = `Awka Facility ${f}`;
      let category = "waste_management";
      if (f === 1) {
        name = "Zebos Hotel";
        category = "hospitality";
      } else if (f === 2) {
        name = "Sunrise Chemical";
        category = "chemical_processing";
      } else if (f === 3) {
        name = "Analysts";
        category = "other";
      }

      await client.query(
        `INSERT INTO facility (id, tenant_id, organization_id, business_name, category, address, latitude, longitude, registration_status, created_by, registration_source, registered_by_user_id)
         VALUES ($1, $2, $3, $4, $5, $6, 6.22, 7.07, 'pending', $7, 'officer', $7)`,
        [
          facilityId,
          tenantId,
          orgId,
          name,
          category,
          `Awka Road, Facility Area ${f}`,
          officerId
        ]
      );

      await client.query(
        `INSERT INTO facility_registration (tenant_id, facility_id, reference_number, client_submission_id, status, submitted_by)
         VALUES ($1, $2, $3, $4, 'submitted', $5)`,
        [tenantId, facilityId, `FAC-REG-${f}-${crypto.randomUUID().substring(0, 4).toUpperCase()}`, `sub-demo-8-${f}`, officerId]
      );

      const attrId = crypto.randomUUID();
      const ipKeyHash = crypto.createHash("sha256").update(`idemp-key-demo-8-${f}`).digest("hex");
      const reqHash = crypto.createHash("sha256").update(JSON.stringify({ businessName: name })).digest("hex");

      await client.query(
        `INSERT INTO subcontractor_facility_attribution (
           id, tenant_id, subcontractor_id, facility_id, licence_id, assignment_id, lga_id,
           registration_status, registration_correlation_id, idempotency_key_hash, request_hash,
           licence_number_snapshot, licence_valid_from_snapshot, licence_expires_at_snapshot,
           assignment_scope_type, assignment_scope_id, assignment_started_at_snapshot, subcontractor_name_snapshot
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, 'completed', $8, $9, $10, 'LIC-DEMO-08', NOW() - INTERVAL '2 days', NOW() + INTERVAL '1 year',
           'lga', $7, NOW() - INTERVAL '2 days', 'Awka Green Shield Ltd'
         )`,
        [
          attrId,
          tenantId,
          sub8ProfileId,
          facilityId,
          licence8Id,
          assignment8Id,
          lgas[0].id,
          crypto.randomUUID(),
          ipKeyHash,
          reqHash
        ]
      );

      if (f === 1) {
        await client.query(
          `INSERT INTO facility_document (id, tenant_id, facility_id, document_name, storage_path, file_size_bytes, mime_type, created_by)
           VALUES ($1, $2, $3, 'zebos_hotel_facade.jpg', '/zebos_hotel_demo.jpg', 204800, 'image/jpeg', $4)`,
          [crypto.randomUUID(), tenantId, facilityId, officerId]
        );
        await logEvent(app8Id, "facility.first_completed", `facility.first_completed:${facilityId}`, new Date(Date.now() - 2 * 24 * 60 * 60 * 1000));
      } else if (f === 2) {
        await client.query(
          `INSERT INTO facility_document (id, tenant_id, facility_id, document_name, storage_path, file_size_bytes, mime_type, created_by)
           VALUES ($1, $2, $3, 'sunrise_chemical_plant.jpg', '/sunrise_chemical_demo.jpg', 307200, 'image/jpeg', $4)`,
          [crypto.randomUUID(), tenantId, facilityId, officerId]
        );
      }
    }

    // Seed 6 Quality Audits for Subcontractor 8
    const audits = [
      { score: 90.00, status: "completed" },
      { score: 85.00, status: "confirmed" },
      { score: 40.00, status: "completed" }, // low score audit
      { score: 70.00, status: "draft" },
      { score: 65.00, status: "disputed" },
      { score: 30.00, status: "confirmed" } // another low score
    ];

    for (let aIdx = 0; aIdx < audits.length; aIdx++) {
      const a = audits[aIdx];
      const auditId = crypto.randomUUID();
      await client.query(
        `INSERT INTO subcontractor_quality_audit (
           id, tenant_id, subcontractor_id, auditor_type, audit_type, associated_resource_type, associated_resource_id, score, status, version
         ) VALUES ($1, $2, $3, 'officer', 'facility', 'facility', $4, $5, $6, 1)`,
        [
          auditId,
          tenantId,
          sub8ProfileId,
          crypto.randomUUID(),
          a.score,
          a.status
        ]
      );
    }

    // Seed 1 active warning and 1 overturned appealed warning
    const warn1Id = crypto.randomUUID();
    await client.query(
      `INSERT INTO subcontractor_enforcement_action (id, tenant_id, subcontractor_id, action_type, reason, status, initiated_by)
       VALUES ($1, $2, $3, 'warning', 'Seeded warning active', 'active', $4)`,
      [warn1Id, tenantId, sub8ProfileId, officerId]
    );

    const warn2Id = crypto.randomUUID();
    await client.query(
      `INSERT INTO subcontractor_enforcement_action (id, tenant_id, subcontractor_id, action_type, reason, status, initiated_by)
       VALUES ($1, $2, $3, 'warning', 'Seeded warning overturned on appeal', 'overturned', $4)`,
      [warn2Id, tenantId, sub8ProfileId, officerId]
    );

    await client.query(
      `INSERT INTO subcontractor_appeal (id, tenant_id, enforcement_action_id, subcontractor_justification, status)
       VALUES ($1, $2, $3, 'Appeal justification', 'approved')`,
      [crypto.randomUUID(), tenantId, warn2Id]
    );

    // Re-evaluate performance score for profile
    const scoreSum = 90.00 + 85.00 + 40.00 + 30.00;
    const avgScore = scoreSum / 4;
    const normScore = avgScore / 20; // 3.06
    await client.query(
      `UPDATE subcontractor_profile 
       SET performance_score = $1, 
           performance_score_calculated_at = NOW(), 
           performance_score_audit_count = 4, 
           performance_score_policy_version = '1.0.0'
       WHERE id = $2`,
      [normScore, sub8ProfileId]
    );

    seededSubs.push({ appId: app8Id, profileId: sub8ProfileId, accessToken: token8, businessName: "Awka Green Shield Ltd" });

    await client.query("COMMIT");
    return {
      tenantId,
      subcontractors: seededSubs,
      lgas,
      clusters
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Clean up helper to keep demo seeding idempotent.
 */
export async function cleanDemoTenantData(client: any, tenantId: string): Promise<void> {
  // Disable triggers during final deletion to keep it clean
  await client.query("ALTER TABLE subcontractor_application_event DISABLE TRIGGER trg_protect_subcontractor_application_event");
  await client.query("ALTER TABLE subcontractor_facility_attribution DISABLE TRIGGER trg_protect_facility_attribution");
  await client.query("ALTER TABLE marketplace_revenue_ledger DISABLE TRIGGER trg_protect_revenue_ledger");

  try {
    // Delete from all tables in correct dependency order
    await client.query("DELETE FROM subcontractor_appeal WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM subcontractor_enforcement_action WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM subcontractor_quality_audit WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM subcontractor_facility_attribution WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM facility_registration WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM facility WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM subcontractor_assignment WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM subcontractor_licence WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM subcontractor_profile WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM marketplace_revenue_ledger WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM marketplace_payment WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM marketplace_invoice WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM subcontractor_screening_result WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM subcontractor_application_snapshot WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM subcontractor_application_document WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM subcontractor_application_event WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM subcontractor_application WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM cluster WHERE tenant_id = $1", [tenantId]);
    await client.query("DELETE FROM local_government_area WHERE tenant_id = $1", [tenantId]);
    // Clean up mock executions
    await client.query("DELETE FROM ai_execution WHERE tenant_id = $1", [tenantId]);
  } finally {
    await client.query("ALTER TABLE subcontractor_application_event ENABLE TRIGGER trg_protect_subcontractor_application_event");
    await client.query("ALTER TABLE subcontractor_facility_attribution ENABLE TRIGGER trg_protect_facility_attribution");
    await client.query("ALTER TABLE marketplace_revenue_ledger ENABLE TRIGGER trg_protect_revenue_ledger");
  }
}
