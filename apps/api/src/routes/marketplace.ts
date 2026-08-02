import { FastifyInstance } from "fastify";
import { Pool } from "pg";
import crypto from "node:crypto";
import { 
  AccessTokenService, 
  MockMarketplaceDocumentStore, 
  SubmissionService,
  OfficerReviewService,
  MarketplacePaymentReconciliationService,
  AssignmentService,
  PerformanceScorecardService,
  EnforcementService,
  AppealService,
  AuditService,
  SubcontractorFacilityRegistrationService,
  MarketplaceAnalyticsService
} from "@govos/core";

export async function marketplaceRoutes(app: FastifyInstance, options: { pool: Pool }) {
  const pool = options.pool;
  const docStore = new MockMarketplaceDocumentStore();
  const submissionService = new SubmissionService(pool);
  const reconciliationService = new MarketplacePaymentReconciliationService(pool);
  const facilityRegistrationService = new SubcontractorFacilityRegistrationService(pool);
  const analyticsService = new MarketplaceAnalyticsService(pool);

  // Helper function to return generic unauthorized errors
  const sendGenericUnauthorized = (reply: any) => {
    return reply.status(401).send({ error: "Unauthorized: Invalid credentials" });
  };

  // 1. Create Application
  app.post("/marketplace/applications", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const body = req.body as any;
    const { 
      tenantId, 
      businessName, 
      registrationNumber, 
      taxIdentifier, 
      contactEmail, 
      contactPhone, 
      operatingAddress, 
      experienceYears, 
      licenseType 
    } = body;

    if (!tenantId) {
      return reply.status(400).send({ error: "Missing required field: tenantId" });
    }

    // Verify tenant is active
    const tenantRes = await pool.query("SELECT status FROM tenant WHERE id = $1", [tenantId]);
    if (tenantRes.rows.length === 0) {
      return reply.status(404).send({ error: "Tenant not found" });
    }
    if (tenantRes.rows[0].status === "suspended") {
      return reply.status(403).send({ error: "Tenant is suspended" });
    }

    // Check duplicates inside tenant
    if (registrationNumber) {
      const regRes = await pool.query(
        "SELECT id FROM subcontractor_application WHERE tenant_id = $1 AND registration_number = $2",
        [tenantId, registrationNumber]
      );
      if (regRes.rows.length > 0) {
        return reply.status(400).send({ error: "An application with this registration number already exists" });
      }
    }

    if (taxIdentifier) {
      const taxRes = await pool.query(
        "SELECT id FROM subcontractor_application WHERE tenant_id = $1 AND tax_identifier = $2",
        [tenantId, taxIdentifier]
      );
      if (taxRes.rows.length > 0) {
        return reply.status(400).send({ error: "An application with this tax identifier already exists" });
      }
    }

    const plaintextToken = AccessTokenService.generateToken();
    const tokenHash = AccessTokenService.hashToken(plaintextToken);

    const insertQuery = `
      INSERT INTO subcontractor_application (
        tenant_id, business_name, registration_number, tax_identifier,
        contact_email, contact_phone, operating_address, experience_years,
        license_type, access_token_hash, status, version
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'draft', 1)
      RETURNING id, status, version
    `;
    const res = await pool.query(insertQuery, [
      tenantId,
      businessName || "",
      registrationNumber || "",
      taxIdentifier || "",
      contactEmail || "",
      contactPhone || "",
      operatingAddress || "",
      experienceYears || 0,
      licenseType || "",
      tokenHash
    ]);

    const appRow = res.rows[0];

    return reply.status(201).send({
      applicationId: appRow.id,
      accessToken: plaintextToken,
      status: appRow.status,
      version: appRow.version
    });
  });

  // 2. Update Application (PATCH)
  app.patch("/marketplace/applications/:id", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const { id } = req.params as { id: string };
    const body = req.body as any;
    const { 
      accessToken, 
      expectedVersion, 
      businessName, 
      registrationNumber, 
      taxIdentifier, 
      contactEmail, 
      contactPhone, 
      operatingAddress, 
      experienceYears, 
      licenseType 
    } = body;

    if (!accessToken) {
      return sendGenericUnauthorized(reply);
    }

    // Fetch existing application
    const appRes = await pool.query("SELECT * FROM subcontractor_application WHERE id = $1", [id]);
    if (appRes.rows.length === 0) {
      return reply.status(404).send({ error: "Application not found" });
    }
    const appRow = appRes.rows[0];

    // Check token hash
    const clientHash = AccessTokenService.hashToken(accessToken);
    if (!AccessTokenService.timingSafeCompare(appRow.access_token_hash, clientHash)) {
      return sendGenericUnauthorized(reply);
    }

    // Check status
    if (!["draft", "more_information_required"].includes(appRow.status)) {
      return reply.status(400).send({ error: "Application cannot be edited in its current state" });
    }

    // Check version conflict
    if (Number(appRow.version) !== expectedVersion) {
      return reply.status(409).send({ error: "Version mismatch conflict" });
    }

    // Duplicates check if changed
    if (registrationNumber && registrationNumber !== appRow.registration_number) {
      const regRes = await pool.query(
        "SELECT id FROM subcontractor_application WHERE tenant_id = $1 AND registration_number = $2 AND id <> $3",
        [appRow.tenant_id, registrationNumber, id]
      );
      if (regRes.rows.length > 0) {
        return reply.status(400).send({ error: "An application with this registration number already exists" });
      }
    }

    if (taxIdentifier && taxIdentifier !== appRow.tax_identifier) {
      const taxRes = await pool.query(
        "SELECT id FROM subcontractor_application WHERE tenant_id = $1 AND tax_identifier = $2 AND id <> $3",
        [appRow.tenant_id, taxIdentifier, id]
      );
      if (taxRes.rows.length > 0) {
        return reply.status(400).send({ error: "An application with this tax identifier already exists" });
      }
    }

    const updateQuery = `
      UPDATE subcontractor_application
      SET business_name = $1, registration_number = $2, tax_identifier = $3,
          contact_email = $4, contact_phone = $5, operating_address = $6,
          experience_years = $7, license_type = $8, version = version + 1, updated_at = NOW()
      WHERE id = $9 AND version = $10
      RETURNING version
    `;
    const updateRes = await pool.query(updateQuery, [
      businessName !== undefined ? businessName : appRow.business_name,
      registrationNumber !== undefined ? registrationNumber : appRow.registration_number,
      taxIdentifier !== undefined ? taxIdentifier : appRow.tax_identifier,
      contactEmail !== undefined ? contactEmail : appRow.contact_email,
      contactPhone !== undefined ? contactPhone : appRow.contact_phone,
      operatingAddress !== undefined ? operatingAddress : appRow.operating_address,
      experienceYears !== undefined ? experienceYears : appRow.experience_years,
      licenseType !== undefined ? licenseType : appRow.license_type,
      id,
      expectedVersion
    ]);

    if (updateRes.rowCount === 0) {
      return reply.status(409).send({ error: "Version mismatch conflict" });
    }

    return reply.send({
      applicationId: id,
      version: updateRes.rows[0].version
    });
  });

  // 3. Status Lookup
  app.post("/marketplace/applications/:id/status", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const { id } = req.params as { id: string };
    const body = req.body as any;
    const { accessToken } = body;

    if (!accessToken) {
      return sendGenericUnauthorized(reply);
    }

    const appRes = await pool.query("SELECT * FROM subcontractor_application WHERE id = $1", [id]);
    if (appRes.rows.length === 0) {
      return reply.status(404).send({ error: "Application not found" });
    }
    const appRow = appRes.rows[0];

    const clientHash = AccessTokenService.hashToken(accessToken);
    if (!AccessTokenService.timingSafeCompare(appRow.access_token_hash, clientHash)) {
      return sendGenericUnauthorized(reply);
    }

    // Fetch associated documents (non-superseded)
    const docsRes = await pool.query(
      "SELECT id, document_type as \"documentType\", storage_key as \"storageKey\", scan_status as \"scanStatus\", verification_status as \"verificationStatus\", uploaded_at as \"uploadedAt\" FROM subcontractor_application_document WHERE application_id = $1 AND superseded_at IS NULL",
      [id]
    );

    // Fetch licence and subcontractorId if issued
    const licenceQuery = await pool.query(
      `SELECT p.id as "subcontractorId", l.verification_code as "licenceCode"
       FROM subcontractor_profile p
       LEFT JOIN subcontractor_licence l ON l.subcontractor_id = p.id
       WHERE p.application_id = $1`,
      [id]
    );
    const licenceRow = licenceQuery.rows[0];

    return reply.send({
      applicationId: appRow.id,
      status: appRow.status,
      version: appRow.version,
      documents: docsRes.rows,
      requiredActions: appRow.status === "more_information_required" ? ["Please review rejected documents and upload replacements"] : [],
      updatedAt: appRow.updated_at,
      subcontractorId: licenceRow ? licenceRow.subcontractorId : null,
      licenceCode: licenceRow ? licenceRow.licenceCode : null,
    });
  });

  // 4. Add Document
  app.post("/marketplace/applications/:id/documents", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const { id } = req.params as { id: string };
    const body = req.body as any;
    const { accessToken, documentType, filename, mimeType, sizeBytes, contentHash } = body;

    if (!accessToken) {
      return sendGenericUnauthorized(reply);
    }

    // Fetch existing application
    const appRes = await pool.query("SELECT * FROM subcontractor_application WHERE id = $1", [id]);
    if (appRes.rows.length === 0) {
      return reply.status(404).send({ error: "Application not found" });
    }
    const appRow = appRes.rows[0];

    // Check token hash
    const clientHash = AccessTokenService.hashToken(accessToken);
    if (!AccessTokenService.timingSafeCompare(appRow.access_token_hash, clientHash)) {
      return sendGenericUnauthorized(reply);
    }

    // Check status
    if (!["draft", "more_information_required"].includes(appRow.status)) {
      return reply.status(400).send({ error: "Application cannot be edited in its current state" });
    }

    // Run document policy checks via storage adapter
    let uploadRes;
    try {
      uploadRes = await docStore.createUpload({
        tenantId: appRow.tenant_id,
        applicationId: id,
        documentType,
        filename,
        mimeType,
        sizeBytes,
        contentHash
      });
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }

    // Run simulated virus scan
    const verifyRes = await docStore.verifyObject({
      storageKey: uploadRes.storageKey,
      expectedSize: sizeBytes,
      expectedHash: contentHash
    });

    // In a transaction, mark old documents of this type superseded, and insert new one
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Mark old document as superseded
      await client.query(
        "UPDATE subcontractor_application_document SET superseded_at = NOW() WHERE tenant_id = $1 AND application_id = $2 AND document_type = $3 AND superseded_at IS NULL",
        [appRow.tenant_id, id, documentType]
      );

      // Insert new document
      const insertDocQuery = `
        INSERT INTO subcontractor_application_document (
          tenant_id, application_id, document_type, storage_key, content_hash, mime_type, size_bytes, scan_status, verification_status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending')
        RETURNING id
      `;
      const docRes = await client.query(insertDocQuery, [
        appRow.tenant_id,
        id,
        documentType,
        uploadRes.storageKey,
        contentHash,
        mimeType,
        sizeBytes,
        verifyRes.scanStatus
      ]);

      await client.query("COMMIT");

      return reply.status(201).send({
        documentId: docRes.rows[0].id,
        storageKey: uploadRes.storageKey,
        scanStatus: verifyRes.scanStatus
      });
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  });

  // 5. Delete Document
  app.delete("/marketplace/applications/:id/documents/:documentId", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const { id, documentId } = req.params as { id: string; documentId: string };
    const body = req.body as any;
    const accessToken = body?.accessToken || req.headers["x-access-token"];

    if (!accessToken) {
      return sendGenericUnauthorized(reply);
    }

    // Fetch existing application
    const appRes = await pool.query("SELECT * FROM subcontractor_application WHERE id = $1", [id]);
    if (appRes.rows.length === 0) {
      return reply.status(404).send({ error: "Application not found" });
    }
    const appRow = appRes.rows[0];

    // Check token hash
    const clientHash = AccessTokenService.hashToken(accessToken);
    if (!AccessTokenService.timingSafeCompare(appRow.access_token_hash, clientHash)) {
      return sendGenericUnauthorized(reply);
    }

    // Check status
    if (!["draft", "more_information_required"].includes(appRow.status)) {
      return reply.status(400).send({ error: "Application cannot be edited in its current state" });
    }

    // Verify document belongs to application
    const docRes = await pool.query(
      "SELECT id FROM subcontractor_application_document WHERE tenant_id = $1 AND application_id = $2 AND id = $3 AND superseded_at IS NULL",
      [appRow.tenant_id, id, documentId]
    );
    if (docRes.rows.length === 0) {
      return reply.status(404).send({ error: "Document not found or already deleted" });
    }

    // Mark superseded
    await pool.query(
      "UPDATE subcontractor_application_document SET superseded_at = NOW() WHERE tenant_id = $1 AND id = $2",
      [appRow.tenant_id, documentId]
    );

    return reply.send({ success: true });
  });

  // 6. Submit Application
  app.post("/marketplace/applications/:id/submit", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const { id } = req.params as { id: string };
    const body = req.body as any;
    const { accessToken, expectedVersion } = body;

    if (!accessToken) {
      return sendGenericUnauthorized(reply);
    }

    // Fetch existing application for tenant lookup
    const appRes = await pool.query("SELECT tenant_id FROM subcontractor_application WHERE id = $1", [id]);
    if (appRes.rows.length === 0) {
      return reply.status(404).send({ error: "Application not found" });
    }
    const tenantId = appRes.rows[0].tenant_id;

    const correlationId = reply.getHeader("x-correlation-id") as string || "system-correlation-id";

    try {
      await submissionService.submitApplication(
        tenantId,
        id,
        accessToken,
        expectedVersion,
        correlationId
      );
    } catch (err: any) {
      if (err.message === "Invalid access token") {
        return sendGenericUnauthorized(reply);
      }
      if (err.message.includes("Version mismatch conflict")) {
        return reply.status(409).send({ error: err.message });
      }
      return reply.status(400).send({ error: err.message });
    }

    return reply.send({ success: true, status: "submitted" });
  });

  // Helper function to authenticate Officer using session token
  async function authenticateOfficer(req: any, reply: any, pool: Pool) {
    const authHeader = req.headers["authorization"];
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      reply.status(401).send({ error: "Unauthorized: Missing credentials" });
      return null;
    }
    const token = authHeader.substring(7);
    const query = `
      SELECT u.id as user_id, u.tenant_id, u.status as user_status,
             t.status as tenant_status
      FROM session s
      JOIN tenant t ON t.id = s.tenant_id
      JOIN user_account u ON u.id = s.user_id
      WHERE s.token = $1 AND s.expires_at > NOW() AND u.deleted_at IS NULL
    `;
    const result = await pool.query(query, [token]);
    if (result.rows.length === 0) {
      reply.status(401).send({ error: "Unauthorized: Invalid or expired token" });
      return null;
    }
    const row = result.rows[0];
    if (row.user_status === "suspended" || row.tenant_status === "suspended") {
      reply.status(403).send({ error: "Forbidden: Account or tenant is suspended" });
      return null;
    }
    return {
      userId: row.user_id,
      tenantId: row.tenant_id
    };
  }

  const reviewService = new OfficerReviewService(pool);

  // 7. Officer Approve
  app.post("/marketplace/applications/:id/approve", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const { id } = req.params as { id: string };
    const officer = await authenticateOfficer(req, reply, pool);
    if (!officer) return;

    const { expectedVersion, decisionReason, screeningResultId, overrideReason } = req.body as any;

    try {
      await reviewService.approveApplication(
        officer.tenantId,
        id,
        expectedVersion,
        decisionReason,
        screeningResultId,
        officer.userId,
        overrideReason
      );
      return reply.send({ success: true });
    } catch (err: any) {
      if (err.message.includes("Version mismatch conflict")) {
        return reply.status(409).send({ error: err.message });
      }
      return reply.status(400).send({ error: err.message });
    }
  });

  // 8. Officer Reject
  app.post("/marketplace/applications/:id/reject", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const { id } = req.params as { id: string };
    const officer = await authenticateOfficer(req, reply, pool);
    if (!officer) return;

    const { expectedVersion, decisionReason, screeningResultId, overrideReason } = req.body as any;

    try {
      await reviewService.rejectApplication(
        officer.tenantId,
        id,
        expectedVersion,
        decisionReason,
        screeningResultId,
        officer.userId,
        overrideReason
      );
      return reply.send({ success: true });
    } catch (err: any) {
      if (err.message.includes("Version mismatch conflict")) {
        return reply.status(409).send({ error: err.message });
      }
      return reply.status(400).send({ error: err.message });
    }
  });

  // 9. Officer Request Information
  app.post("/marketplace/applications/:id/request-information", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const { id } = req.params as { id: string };
    const officer = await authenticateOfficer(req, reply, pool);
    if (!officer) return;

    const { expectedVersion, decisionReason, screeningResultId } = req.body as any;

    try {
      await reviewService.requestInformation(
        officer.tenantId,
        id,
        expectedVersion,
        decisionReason,
        screeningResultId,
        officer.userId
      );
      return reply.send({ success: true });
    } catch (err: any) {
      if (err.message.includes("Version mismatch conflict")) {
        return reply.status(409).send({ error: err.message });
      }
      return reply.status(400).send({ error: err.message });
    }
  });

  // 10. Create Checkout Session
  app.post("/marketplace/applications/:id/checkout-session", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const { id } = req.params as { id: string };
    const { accessToken, expectedVersion } = req.body as { accessToken: string; expectedVersion: number };

    if (!accessToken) {
      return reply.status(400).send({ error: "Access token is required" });
    }

    const appQuery = await pool.query(
      "SELECT * FROM subcontractor_application WHERE id = $1",
      [id]
    );
    if (appQuery.rows.length === 0) {
      return sendGenericUnauthorized(reply);
    }
    const appRow = appQuery.rows[0];
    const clientHash = AccessTokenService.hashToken(accessToken);
    if (!AccessTokenService.timingSafeCompare(appRow.access_token_hash, clientHash)) {
      return sendGenericUnauthorized(reply);
    }

    if (Number(appRow.version) !== Number(expectedVersion)) {
      return reply.status(409).send({ error: "Version mismatch conflict" });
    }

    if (appRow.status !== "invoice_pending" && appRow.status !== "payment_pending") {
      return reply.status(400).send({ error: "Application is not in invoice_pending or payment_pending state" });
    }

    const invoiceQuery = await pool.query(
      "SELECT * FROM marketplace_invoice WHERE application_id = $1 AND status = 'unpaid'",
      [id]
    );
    if (invoiceQuery.rows.length === 0) {
      return reply.status(400).send({ error: "No unpaid invoice found for this application" });
    }
    const invoice = invoiceQuery.rows[0];

    const existingPaymentQuery = await pool.query(
      "SELECT * FROM marketplace_payment WHERE invoice_id = $1 AND status IN ('created', 'pending')",
      [invoice.id]
    );
    if (existingPaymentQuery.rows.length > 0) {
      const existingPayment = existingPaymentQuery.rows[0];
      return reply.send({
        checkoutSessionId: existingPayment.provider_checkout_reference,
        redirectUrl: `/marketplace/checkout/${existingPayment.id}`,
        paymentId: existingPayment.id
      });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      if (appRow.status === "invoice_pending") {
        await client.query(
          "UPDATE subcontractor_application SET status = 'payment_pending', version = version + 1, updated_at = NOW() WHERE id = $1",
          [id]
        );
      }

      const paymentId = crypto.randomUUID();
      const checkoutRef = `CS_${crypto.randomUUID()}`;
      
      await client.query(
        `INSERT INTO marketplace_payment (
          id, tenant_id, invoice_id, provider, provider_checkout_reference, provider_transaction_reference, amount_paid_microunits, currency, status
        ) VALUES ($1, $2, $3, 'stripe', $4, null, $5, $6, 'created')`,
        [paymentId, appRow.tenant_id, invoice.id, checkoutRef, invoice.amount_due_microunits, invoice.currency]
      );

      await client.query("COMMIT");

      return reply.send({
        checkoutSessionId: checkoutRef,
        redirectUrl: `/marketplace/checkout/${paymentId}`,
        paymentId: paymentId
      });
    } catch (err: any) {
      await client.query("ROLLBACK");
      return reply.status(500).send({ error: err.message });
    } finally {
      client.release();
    }
  });

  // Demo webhook bypass for guided presentation
  app.post("/marketplace/payments/demo-complete", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const { checkoutSessionId } = req.body as { checkoutSessionId: string };
    if (!checkoutSessionId) {
      return reply.status(400).send({ error: "Missing checkoutSessionId" });
    }

    try {
      // Find payment record
      const paymentQuery = await pool.query(
        "SELECT * FROM marketplace_payment WHERE provider_checkout_reference = $1",
        [checkoutSessionId]
      );
      if (paymentQuery.rows.length === 0) {
        return reply.status(404).send({ error: "Payment checkout reference not found" });
      }

      // Compute signature server-side
      const webhookPayload = {
        id: `evt_${crypto.randomUUID()}`,
        type: "checkout.session.completed",
        checkout_reference: checkoutSessionId,
        transaction_reference: `tx-ref-demo-${crypto.randomUUID().substring(0, 6)}`,
        amount: 500000000,
        currency: "usd"
      };
      const rawBody = JSON.stringify(webhookPayload);
      const secret = process.env.WEBHOOK_SECRET || "mock-secret-key";

      const hmac = crypto.createHmac("sha256", secret);
      hmac.update(rawBody);
      const signature = hmac.digest("hex");

      const result = await reconciliationService.processWebhook(
        "stripe",
        rawBody,
        signature,
        secret,
        webhookPayload
      );

      return reply.status(200).send(result);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // 11. Payment Provider Webhooks
  app.post("/marketplace/payments/webhooks/:provider", async (req, reply) => {
    const { provider } = req.params as { provider: string };
    const signature = req.headers["x-webhook-signature"] as string;
    const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
    const secret = process.env.WEBHOOK_SECRET || "mock-secret-key";
    const bodyObj = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    try {
      const result = await reconciliationService.processWebhook(
        provider,
        rawBody,
        signature,
        secret,
        bodyObj
      );
      return reply.status(200).send(result);
    } catch (err: any) {
      if (err.message === "UNAUTHORIZED_SIGNATURE") {
        return reply.status(401).send({ error: "Invalid signature" });
      }
      return reply.status(400).send({ error: err.message });
    }
  });

  // 12. Public QR Verification Endpoint
  app.get("/public/marketplace/licences/:code", async (req, reply) => {
    const { code } = req.params as { code: string };

    const licenceQuery = await pool.query(
      `SELECT l.*, p.business_name 
       FROM subcontractor_licence l
       JOIN subcontractor_profile p ON p.id = l.subcontractor_id
       WHERE l.verification_code = $1`,
      [code]
    );

    if (licenceQuery.rows.length === 0) {
      return reply.status(404).send({ error: "Licence not found" });
    }

    const row = licenceQuery.rows[0];
    return reply.status(200).send({
      verified: true,
      verificationTime: new Date().toISOString(),
      issuingAuthority: "Anambra State Ministry of Environment",
      businessName: row.business_name,
      licenceNumber: row.licence_number,
      licenceType: row.licence_type,
      status: row.status,
      issuedAt: row.issued_at,
      expiresAt: row.expires_at
    });
  });

  const assignmentService = new AssignmentService(pool);

  // 13. List Geography Regions
  app.get("/marketplace/regions", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const officer = await authenticateOfficer(req, reply, pool);
    if (!officer) return;

    const lgasRes = await pool.query(
      "SELECT id, name, state_name as \"stateName\" FROM local_government_area WHERE tenant_id = $1 ORDER BY name ASC",
      [officer.tenantId]
    );
    const clustersRes = await pool.query(
      "SELECT id, name, region_details as \"regionDetails\" FROM cluster WHERE tenant_id = $1 ORDER BY name ASC",
      [officer.tenantId]
    );

    return reply.send({
      lgas: lgasRes.rows,
      clusters: clustersRes.rows
    });
  });

  // 14. Create Assignment
  app.post("/marketplace/assignments", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const officer = await authenticateOfficer(req, reply, pool);
    if (!officer) return;

    const { subcontractorId, assignmentType, targetId, startsAt } = req.body as any;

    if (!subcontractorId || !assignmentType || !targetId) {
      return reply.status(400).send({ error: "Missing required fields: subcontractorId, assignmentType, targetId" });
    }

    try {
      const assignment = await assignmentService.assignTerritory(
        officer.tenantId,
        subcontractorId,
        assignmentType,
        targetId,
        startsAt || new Date().toISOString(),
        officer.userId
      );
      return reply.status(201).send(assignment);
    } catch (err: any) {
      if (err.message === "FUTURE_ASSIGNMENT_PROHIBITED") {
        return reply.status(400).send({ error: "Starts_at date cannot be in the future" });
      }
      if (err.message === "SUBCONTRACTOR_NOT_FOUND") {
        return reply.status(404).send({ error: "Subcontractor profile not found or not active" });
      }
      if (err.message === "UNLICENSED_SUBCONTRACTOR") {
        return reply.status(400).send({ error: "Subcontractor does not hold a valid active licence for this period" });
      }
      if (err.message === "GEOGRAPHY_NOT_FOUND") {
        return reply.status(404).send({ error: "Target LGA or Cluster geography not found" });
      }
      if (err.message === "TERRITORY_ALREADY_ASSIGNED") {
        return reply.status(409).send({ error: "Territory is already assigned to another subcontractor for this active range" });
      }
      return reply.status(500).send({ error: err.message });
    }
  });

  // 15. Terminate Assignment
  app.post("/marketplace/assignments/:id/terminate", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const { id } = req.params as { id: string };
    const officer = await authenticateOfficer(req, reply, pool);
    if (!officer) return;

    const { expectedVersion } = req.body as { expectedVersion: number };
    if (expectedVersion === undefined) {
      return reply.status(400).send({ error: "Missing expectedVersion" });
    }

    try {
      const assignment = await assignmentService.terminateAssignment(
        officer.tenantId,
        id,
        expectedVersion
      );
      return reply.send(assignment);
    } catch (err: any) {
      if (err.message === "ASSIGNMENT_NOT_FOUND") {
        return reply.status(404).send({ error: "Assignment not found" });
      }
      if (err.message === "ASSIGNMENT_ALREADY_TERMINATED") {
        return reply.status(400).send({ error: "Assignment is already terminated" });
      }
      if (err.message === "VERSION_MISMATCH_CONFLICT") {
        return reply.status(409).send({ error: "Version mismatch conflict" });
      }
      return reply.status(500).send({ error: err.message });
    }
  });

  // 16. List Assignments
  app.get("/marketplace/assignments", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const officer = await authenticateOfficer(req, reply, pool);
    if (!officer) return;

    const { subcontractorId } = req.query as { subcontractorId?: string };

    let query = `
      SELECT id, tenant_id as "tenantId", subcontractor_id as "subcontractorId", assignment_type as "assignmentType",
             lga_id as "lgaId", cluster_id as "clusterId", status, starts_at as "startsAt", ends_at as "endsAt",
             assigned_by as "assignedBy", version, created_at as "createdAt", updated_at as "updatedAt"
      FROM subcontractor_assignment
      WHERE tenant_id = $1
    `;
    const params: any[] = [officer.tenantId];

    if (subcontractorId) {
      query += " AND subcontractor_id = $2";
      params.push(subcontractorId);
    }

    query += " ORDER BY starts_at DESC";

    const res = await pool.query(query, params);
    return reply.send(res.rows);
  });

  const enforcementService = new EnforcementService(pool);
  const scorecardService = new PerformanceScorecardService(enforcementService);
  const auditService = new AuditService(pool, scorecardService);
  const appealService = new AppealService(pool);

  // 17. Officer: Create Audit
  app.post("/officer/marketplace/audits", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const officer = await authenticateOfficer(req, reply, pool);
    if (!officer) return;

    const {
      subcontractorId,
      auditorType,
      auditorId,
      aiExecutionId,
      auditType,
      associatedResourceType,
      associatedResourceId,
      score,
      statusOverride,
      findings
    } = req.body as any;

    if (!subcontractorId || !auditorType || score === undefined || !auditType) {
      return reply.status(400).send({ error: "Missing required fields" });
    }

    const correlationId = reply.getHeader("x-correlation-id") as string || "system-correlation-id";

    try {
      const audit = await auditService.createAudit(
        officer.tenantId,
        subcontractorId,
        auditorType,
        auditorId || officer.userId,
        aiExecutionId,
        auditType,
        associatedResourceType,
        associatedResourceId,
        score,
        statusOverride,
        findings || [],
        correlationId
      );
      return reply.status(201).send(audit);
    } catch (err: any) {
      if (err.message === "EVIDENCE_REQUIRED") {
        return reply.status(400).send({ error: "Evidence references are required for high or critical findings" });
      }
      if (err.message === "SUBCONTRACTOR_NOT_FOUND") {
        return reply.status(404).send({ error: "Subcontractor profile not found or not active" });
      }
      return reply.status(500).send({ error: err.message });
    }
  });

  // 18. Officer: Confirm AI Audit
  app.post("/officer/marketplace/audits/:id/confirm", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const officer = await authenticateOfficer(req, reply, pool);
    if (!officer) return;

    const { id } = req.params as { id: string };
    const { expectedVersion } = req.body as { expectedVersion: number };
    if (expectedVersion === undefined) {
      return reply.status(400).send({ error: "Missing expectedVersion" });
    }

    const correlationId = reply.getHeader("x-correlation-id") as string || "system-correlation-id";

    try {
      const audit = await auditService.confirmAiAudit(
        officer.tenantId,
        id,
        expectedVersion,
        officer.userId,
        correlationId
      );
      return reply.send(audit);
    } catch (err: any) {
      if (err.message === "AUDIT_NOT_FOUND") {
        return reply.status(404).send({ error: "Audit not found" });
      }
      if (err.message === "VERSION_MISMATCH_CONFLICT") {
        return reply.status(409).send({ error: "Version mismatch conflict" });
      }
      if (err.message === "AUDIT_ALREADY_CONFIRMED") {
        return reply.status(400).send({ error: "Audit is already confirmed" });
      }
      return reply.status(500).send({ error: err.message });
    }
  });

  // 19. Officer: Resolve Audit Dispute
  app.post("/officer/marketplace/audits/:id/resolve", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const officer = await authenticateOfficer(req, reply, pool);
    if (!officer) return;

    const { id } = req.params as { id: string };
    const { expectedVersion, decision } = req.body as { expectedVersion: number; decision: "confirmed" | "overturned" };

    if (expectedVersion === undefined || !decision) {
      return reply.status(400).send({ error: "Missing expectedVersion or decision" });
    }

    const correlationId = reply.getHeader("x-correlation-id") as string || "system-correlation-id";

    try {
      const audit = await auditService.resolveAuditDispute(
        officer.tenantId,
        id,
        expectedVersion,
        decision,
        officer.userId,
        correlationId
      );
      return reply.send(audit);
    } catch (err: any) {
      if (err.message === "AUDIT_NOT_FOUND") {
        return reply.status(404).send({ error: "Audit not found" });
      }
      if (err.message === "VERSION_MISMATCH_CONFLICT") {
        return reply.status(409).send({ error: "Version mismatch conflict" });
      }
      if (err.message === "AUDIT_NOT_DISPUTED") {
        return reply.status(400).send({ error: "Audit is not currently disputed" });
      }
      return reply.status(500).send({ error: err.message });
    }
  });

  // 20. Officer: Decide Appeal
  app.post("/officer/marketplace/appeals/:id/decide", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const officer = await authenticateOfficer(req, reply, pool);
    if (!officer) return;

    const { id } = req.params as { id: string };
    const { expectedVersion, decision, officerDecision } = req.body as { expectedVersion: number; decision: "approved" | "rejected"; officerDecision: string };

    if (expectedVersion === undefined || !decision || !officerDecision) {
      return reply.status(400).send({ error: "Missing expectedVersion, decision or officerDecision" });
    }

    try {
      const appeal = await appealService.decideAppeal(
        officer.tenantId,
        id,
        expectedVersion,
        decision,
        officerDecision,
        officer.userId
      );
      return reply.send(appeal);
    } catch (err: any) {
      if (err.message === "APPEAL_NOT_FOUND") {
        return reply.status(404).send({ error: "Appeal not found" });
      }
      if (err.message === "VERSION_MISMATCH_CONFLICT") {
        return reply.status(409).send({ error: "Version mismatch conflict" });
      }
      if (err.message === "APPEAL_ALREADY_DECIDED") {
        return reply.status(400).send({ error: "Appeal is already decided" });
      }
      return reply.status(500).send({ error: err.message });
    }
  });

  // 21. Officer: Proactive manual warning/suspension/revocation
  app.post("/officer/marketplace/enforcements", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const officer = await authenticateOfficer(req, reply, pool);
    if (!officer) return;

    const { subcontractorId, actionType, reason, expectedProfileVersion } = req.body as any;

    if (!subcontractorId || !actionType || !reason || expectedProfileVersion === undefined) {
      return reply.status(400).send({ error: "Missing required fields" });
    }

    // Query platform role assignments to map permissions
    const permRes = await pool.query(
      `SELECT role_name FROM platform_role_assignment WHERE user_id = $1 AND assignment_status = 'active'`,
      [officer.userId]
    );
    const roles = permRes.rows.map(r => r.role_name);

    const permissions: string[] = [];
    if (roles.includes("PLATFORM_SUPER_ADMIN")) {
      permissions.push("marketplace.enforcement.suspend", "marketplace.enforcement.revoke");
    }
    if (roles.includes("PLATFORM_SUPPORT_ADMIN")) {
      permissions.push("marketplace.enforcement.suspend");
    }

    try {
      const action = await enforcementService.createOfficerEnforcement(
        officer.tenantId,
        subcontractorId,
        actionType,
        reason,
        officer.userId,
        expectedProfileVersion,
        permissions
      );
      return reply.status(201).send(action);
    } catch (err: any) {
      if (err.message === "FORBIDDEN_INSUFFICIENT_PERMISSIONS") {
        return reply.status(403).send({ error: "Officer lacks permissions for this enforcement action type" });
      }
      if (err.message === "SUBCONTRACTOR_NOT_FOUND") {
        return reply.status(404).send({ error: "Subcontractor profile not found" });
      }
      if (err.message === "VERSION_MISMATCH_CONFLICT") {
        return reply.status(409).send({ error: "Version mismatch conflict" });
      }
      return reply.status(500).send({ error: err.message });
    }
  });

  // 22. Subcontractor: Dispute Completed/Confirmed Audit
  app.post("/marketplace/audits/:id/dispute", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const { id } = req.params as { id: string };
    const { accessToken, expectedVersion } = req.body as { accessToken: string; expectedVersion: number };

    if (!accessToken || expectedVersion === undefined) {
      return reply.status(400).send({ error: "Missing accessToken or expectedVersion" });
    }

    const auditRes = await pool.query(
      `SELECT a.*, p.application_id, app.access_token_hash
       FROM subcontractor_quality_audit a
       JOIN subcontractor_profile p ON p.id = a.subcontractor_id
       JOIN subcontractor_application app ON app.id = p.application_id
       WHERE a.id = $1`,
      [id]
    );

    if (auditRes.rows.length === 0) {
      return reply.status(404).send({ error: "Audit not found" });
    }
    const audit = auditRes.rows[0];

    const clientHash = AccessTokenService.hashToken(accessToken);
    if (!AccessTokenService.timingSafeCompare(audit.access_token_hash, clientHash)) {
      return sendGenericUnauthorized(reply);
    }

    try {
      const updated = await auditService.disputeAudit(audit.tenant_id, id, expectedVersion);
      return reply.send(updated);
    } catch (err: any) {
      if (err.message === "VERSION_MISMATCH_CONFLICT") {
        return reply.status(409).send({ error: "Version mismatch conflict" });
      }
      if (err.message === "AUDIT_NOT_ELIGIBLE_FOR_DISPUTE") {
        return reply.status(400).send({ error: "Audit is not eligible for dispute" });
      }
      return reply.status(500).send({ error: err.message });
    }
  });

  // 23. Subcontractor: Appeal Active/Stayed Enforcement Action
  app.post("/marketplace/enforcements/:id/appeal", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const { id } = req.params as { id: string };
    const { accessToken, justification } = req.body as { accessToken: string; justification: string };

    if (!accessToken || !justification) {
      return reply.status(400).send({ error: "Missing accessToken or justification" });
    }

    const enfRes = await pool.query(
      `SELECT e.*, p.application_id, app.access_token_hash
       FROM subcontractor_enforcement_action e
       JOIN subcontractor_profile p ON p.id = e.subcontractor_id
       JOIN subcontractor_application app ON app.id = p.application_id
       WHERE e.id = $1`,
      [id]
    );

    if (enfRes.rows.length === 0) {
      return reply.status(404).send({ error: "Enforcement action not found" });
    }
    const action = enfRes.rows[0];

    const clientHash = AccessTokenService.hashToken(accessToken);
    if (!AccessTokenService.timingSafeCompare(action.access_token_hash, clientHash)) {
      return sendGenericUnauthorized(reply);
    }

    try {
      const appeal = await appealService.submitAppeal(action.tenant_id, id, justification);
      return reply.status(201).send(appeal);
    } catch (err: any) {
      if (err.message === "INELIGIBLE_FOR_APPEAL") {
        return reply.status(400).send({ error: "Enforcement action is not eligible for appeal" });
      }
      if (err.message === "APPEAL_ALREADY_PENDING") {
        return reply.status(409).send({ error: "An appeal is already pending for this enforcement action" });
      }
      return reply.status(500).send({ error: err.message });
    }
  });

  // 24. Shared: Subcontractor Scorecard (Tenant and Subcontractor Shared)
  app.get("/marketplace/subcontractors/:id/scorecard", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    const { id } = req.params as { id: string };

    const profileRes = await pool.query(
      `SELECT p.*, app.access_token_hash
       FROM subcontractor_profile p
       JOIN subcontractor_application app ON app.id = p.application_id
       WHERE p.id = $1`,
      [id]
    );

    if (profileRes.rows.length === 0) {
      return reply.status(404).send({ error: "Subcontractor profile not found" });
    }
    const profile = profileRes.rows[0];

    let tenantId = profile.tenant_id;
    let authorized = false;

    // Check if officer authorization header is present
    const authHeader = req.headers["authorization"];
    if (authHeader && authHeader.startsWith("Bearer ")) {
      const officer = await authenticateOfficer(req, reply, pool);
      if (officer && officer.tenantId === tenantId) {
        authorized = true;
      }
    } else {
      // Subcontractor authentication using token
      const tokenHeader = req.headers["x-access-token"] as string;
      const tokenQuery = (req.query as any).accessToken as string;
      const accessToken = tokenHeader || tokenQuery;

      if (accessToken) {
        const clientHash = AccessTokenService.hashToken(accessToken);
        if (AccessTokenService.timingSafeCompare(profile.access_token_hash, clientHash)) {
          authorized = true;
        }
      }
    }

    if (!authorized) {
      return reply.status(401).send({ error: "Unauthorized: Invalid credentials" });
    }

    // Fetch audits (redacted)
    const auditsRes = await pool.query(
      `SELECT id, auditor_type as "auditorType", audit_type as "auditType", associated_resource_type as "associatedResourceType", score, status, created_at as "createdAt", version
       FROM subcontractor_quality_audit
       WHERE tenant_id = $1 AND subcontractor_id = $2
       ORDER BY created_at DESC`,
      [tenantId, id]
    );

    // Fetch findings for these audits (redacted evidence_references)
    const auditsList = auditsRes.rows;
    for (const audit of auditsList) {
      const findingsRes = await pool.query(
        `SELECT id, finding_code as "findingCode", severity, description
         FROM subcontractor_quality_finding
         WHERE tenant_id = $1 AND audit_id = $2`,
        [tenantId, audit.id]
      );
      audit.findings = findingsRes.rows;
    }

    // Fetch enforcement actions (redacted trigger reference / initiator)
    const enforcementsRes = await pool.query(
      `SELECT id, action_type as "actionType", reason, status, created_at as "createdAt", version
       FROM subcontractor_enforcement_action
       WHERE tenant_id = $1 AND subcontractor_id = $2
       ORDER BY created_at DESC`,
      [tenantId, id]
    );

    // Fetch appeals for these actions
    const enforcementsList = enforcementsRes.rows;
    for (const action of enforcementsList) {
      const appealsRes = await pool.query(
        `SELECT id, subcontractor_justification as "subcontractorJustification", status, created_at as "createdAt", version
         FROM subcontractor_appeal
         WHERE tenant_id = $1 AND enforcement_action_id = $2`,
        [tenantId, action.id]
      );
      action.appeals = appealsRes.rows;
    }

    return reply.send({
      subcontractorId: profile.id,
      businessName: profile.business_name,
      status: profile.status,
      performanceScore: profile.performance_score !== null ? Number(profile.performance_score) : null,
      policyVersion: profile.performance_score_policy_version,
      calculatedAt: profile.performance_score_calculated_at,
      auditCount: profile.performance_score_audit_count,
      audits: auditsList,
      enforcementActions: enforcementsList
    });
  });

  // Helper function to extract and validate analytics query parameters
  async function getAnalyticsParams(req: any, reply: any, pool: Pool) {
    const officer = await authenticateOfficer(req, reply, pool);
    if (!officer) return null;

    const query = req.query as any;
    const from = query.from || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const to = query.to || new Date().toISOString();

    const filters = {
      lgaId: query.lgaId || undefined,
      clusterId: query.clusterId || undefined,
      licenceType: query.licenceType || undefined,
      currency: query.currency || undefined
    };

    return {
      tenantId: officer.tenantId,
      range: { from, to },
      filters
    };
  }

  // 25. Subcontractor: Register Facility (idempotent, atomic transaction)
  app.post("/marketplace/facilities/register", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    
    let accessToken = "";
    const authHeader = req.headers["authorization"];
    if (authHeader && authHeader.startsWith("Bearer ")) {
      accessToken = authHeader.substring(7);
    } else {
      accessToken = (req.headers["x-access-token"] as string) || (req.body as any)?.accessToken || "";
    }

    if (!accessToken) {
      return reply.status(401).send({ error: "Unauthorized: Missing accessToken" });
    }

    const idempotencyKey = (req.headers["idempotency-key"] as string) || (req.headers["x-idempotency-key"] as string) || "";
    if (!idempotencyKey) {
      return reply.status(400).send({ error: "Missing required header: Idempotency-Key" });
    }

    const body = req.body as any;
    const { businessName, category, address, latitude, longitude, town, lgaId, clusterId, correlationId } = body;

    if (!businessName || !category || !address || latitude === undefined || longitude === undefined || !correlationId) {
      return reply.status(400).send({ error: "Missing required fields" });
    }

    const clientHash = AccessTokenService.hashToken(accessToken);
    const subRes = await pool.query(
      `SELECT p.id, p.tenant_id 
       FROM subcontractor_profile p
       JOIN subcontractor_application app ON app.id = p.application_id
       WHERE app.access_token_hash = $1`,
      [clientHash]
    );
    if (subRes.rows.length === 0) {
      return reply.status(401).send({ error: "Unauthorized: Invalid credentials" });
    }
    const subcontractor = subRes.rows[0];

    try {
      const result = await facilityRegistrationService.registerFacility(
        subcontractor.tenant_id,
        subcontractor.id,
        { businessName, category, address, latitude, longitude, town, lgaId, clusterId },
        correlationId,
        idempotencyKey
      );
      return reply.send(result);
    } catch (err: any) {
      if (err.message === "IDEMPOTENCY_CONFLICT") {
        return reply.status(409).send({ error: "Conflict: Idempotency key already used for a different request payload" });
      }
      if (err.message === "SUBCONTRACTOR_NOT_FOUND") {
        return reply.status(404).send({ error: "Subcontractor profile not found" });
      }
      if (err.message === "ACTIVE_LICENCE_REQUIRED") {
        return reply.status(403).send({ error: "Forbidden: Active licence required for facility registration" });
      }
      if (err.message === "GEOGRAPHIC_BOUNDARY_VIOLATION") {
        return reply.status(400).send({ error: "Bad Request: Facility lies outside assigned geography boundary" });
      }
      if (err.message === "POTENTIAL_DUPLICATE_DETECTED") {
        return reply.status(409).send({ error: "Potential duplicate facility detected." });
      }
      return reply.status(500).send({ error: err.message || "Internal server error during facility registration" });
    }
  });

  // 26. Officer: Get Analytics Summary
  app.get("/officer/marketplace/analytics/summary", async (req, reply) => {
    const params = await getAnalyticsParams(req, reply, pool);
    if (!params) return;
    try {
      const summary = await analyticsService.getSummary(params.tenantId, params.range, params.filters);
      return reply.send(summary);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // 27. Officer: Get Funnel Analytics
  app.get("/officer/marketplace/analytics/funnel", async (req, reply) => {
    const params = await getAnalyticsParams(req, reply, pool);
    if (!params) return;
    try {
      const funnel = await analyticsService.getFunnel(params.tenantId, params.range, params.filters);
      return reply.send(funnel);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // 28. Officer: Get Screening Analytics
  app.get("/officer/marketplace/analytics/screening", async (req, reply) => {
    const params = await getAnalyticsParams(req, reply, pool);
    if (!params) return;
    try {
      const screening = await analyticsService.getScreening(params.tenantId, params.range, params.filters);
      return reply.send(screening);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // 29. Officer: Get Revenue Analytics
  app.get("/officer/marketplace/analytics/revenue", async (req, reply) => {
    const params = await getAnalyticsParams(req, reply, pool);
    if (!params) return;
    try {
      const revenue = await analyticsService.getRevenue(params.tenantId, params.range, params.filters);
      return reply.send(revenue);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // 30. Officer: Get Licences Analytics
  app.get("/officer/marketplace/analytics/licences", async (req, reply) => {
    const params = await getAnalyticsParams(req, reply, pool);
    if (!params) return;
    try {
      const licences = await analyticsService.getLicences(params.tenantId, params.range, params.filters);
      return reply.send(licences);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // 31. Officer: Get Assignments Analytics
  app.get("/officer/marketplace/analytics/assignments", async (req, reply) => {
    const params = await getAnalyticsParams(req, reply, pool);
    if (!params) return;
    try {
      const assignment = await analyticsService.getAssignment(params.tenantId, params.range, params.filters);
      return reply.send(assignment);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // 32. Officer: Get Acquisition Analytics
  app.get("/officer/marketplace/analytics/acquisition", async (req, reply) => {
    const params = await getAnalyticsParams(req, reply, pool);
    if (!params) return;
    try {
      const acquisition = await analyticsService.getAcquisition(params.tenantId, params.range, params.filters);
      return reply.send(acquisition);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });

  // 33. Officer: Get Quality Analytics
  app.get("/officer/marketplace/analytics/quality", async (req, reply) => {
    const params = await getAnalyticsParams(req, reply, pool);
    if (!params) return;
    try {
      const quality = await analyticsService.getQuality(params.tenantId, params.range, params.filters);
      return reply.send(quality);
    } catch (err: any) {
      return reply.status(400).send({ error: err.message });
    }
  });
}
