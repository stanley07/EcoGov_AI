/* eslint-disable no-console, @typescript-eslint/no-explicit-any */
import * as readline from "node:readline";
import { Pool } from "pg";
import { loadConfig } from "@govos/configuration";
import { Argon2idPasswordHasher } from "./hasher.js";
import {
  DEFAULT_TENANT_ID,
  DEFAULT_ORG_ID,
  DEFAULT_ADMIN_USER_ID,
  DEFAULT_TENANT_NAME,
  DEFAULT_ORG_NAME,
  ROLES,
  PERMISSIONS,
  OFFICER_PERMS,
  OFFICER_ROLES,
} from "./bootstrap_seed.js";


async function prompt(query: string, secure = false): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    if (secure) {
      const stdin = process.stdin as any;
      const onData = (char: string) => {
        char = char + "";
        switch (char) {
          case "\n":
          case "\r":
          case "\u0004":
            stdin.removeListener("data", onData);
            break;
          default:
            process.stdout.write("\x1B[2D\x1B[0K*");
            break;
        }
      };
      process.stdin.on("data", onData);
    }

    rl.question(query, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function bootstrap() {
  const config = loadConfig();
  const pool = new Pool({
    connectionString: config.database.DATABASE_URL,
  });

  const client = await pool.connect();
  try {
    const initRes = await client.query("SELECT COUNT(*) FROM tenant");
    if (parseInt(initRes.rows[0].count, 10) > 0) {
      console.log("Database is already initialized. Refusing to bootstrap.");
      process.exit(0);
    }

    let tenantName = process.env.TENANT_NAME || "";
    let adminEmail = process.env.ADMIN_EMAIL || "";
    let adminPassword = process.env.ADMIN_PASSWORD || "";
    let firstName = process.env.ADMIN_FIRST_NAME || "";
    let lastName = process.env.ADMIN_LAST_NAME || "";

    const isInteractive = !tenantName || !adminEmail || !adminPassword;

    if (isInteractive) {
      console.log("=== GovOS Platform Bootstrap CLI ===");
      if (!tenantName) {
        const input = await prompt(`Enter Tenant Name (default: ${DEFAULT_TENANT_NAME}): `);
        tenantName = input || DEFAULT_TENANT_NAME;
      }
      if (!adminEmail) {
        adminEmail = await prompt("Enter Admin Email: ");
      }
      if (!adminPassword) {
        adminPassword = await prompt(
          "Enter Admin Password (min 8 chars): ",
          true,
        );
        console.log("");
      }
      if (!firstName) {
        firstName = await prompt("Enter Admin First Name: ");
      }
      if (!lastName) {
        lastName = await prompt("Enter Admin Last Name: ");
      }
    }

    if (
      !tenantName ||
      !adminEmail ||
      !adminPassword ||
      !firstName ||
      !lastName
    ) {
      console.error("Error: All bootstrap parameters must be specified.");
      process.exit(1);
    }

    if (adminPassword.length < 8) {
      console.error("Error: Password must be at least 8 characters long.");
      process.exit(1);
    }

    const hasher = new Argon2idPasswordHasher();
    const passwordHash = await hasher.hash(adminPassword);

    await client.query("BEGIN");

    const tenantId = DEFAULT_TENANT_ID;
    await client.query(
      `INSERT INTO tenant (id, name, type, status) VALUES ($1, $2, 'ministry', 'active')`,
      [tenantId, tenantName],
    );

    const orgId = DEFAULT_ORG_ID;
    const orgName = tenantName === DEFAULT_TENANT_NAME ? DEFAULT_ORG_NAME : tenantName + " HQ";
    await client.query(
      `INSERT INTO organization (id, tenant_id, name, status) VALUES ($1, $2, $3, 'active')`,
      [orgId, tenantId, orgName],
    );

    const adminUserId = DEFAULT_ADMIN_USER_ID;
    await client.query(
      `INSERT INTO user_account (id, tenant_id, email, password_hash, first_name, last_name, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')`,
      [adminUserId, tenantId, adminEmail, passwordHash, firstName, lastName],
    );

    for (const role of ROLES) {
      await client.query(
        `INSERT INTO role (id, tenant_id, name, description, is_system) VALUES ($1, $2, $3, $4, TRUE)`,
        [role.id, tenantId, role.name, role.desc],
      );
    }

    for (const perm of PERMISSIONS) {
      await client.query(
        `INSERT INTO permission (tenant_id, name, description) VALUES ($1, $2, $3)`,
        [tenantId, perm, `Permission to ${perm}`],
      );
    }

    const permQuery = await client.query(
      "SELECT id FROM permission WHERE tenant_id = $1",
      [tenantId],
    );
    for (const row of permQuery.rows) {
      await client.query(
        `INSERT INTO role_permission (role_id, permission_id) VALUES ('00000000-0000-0000-0000-000000000501', $1)`,
        [row.id],
      );
    }

    const reviewPerm = await client.query(
      "SELECT id FROM permission WHERE name = 'facility:review' AND tenant_id = $1",
      [tenantId],
    );
    if (reviewPerm.rows.length > 0) {
      for (const roleId of OFFICER_ROLES) {
        await client.query(
          `INSERT INTO role_permission (role_id, permission_id) VALUES ($1, $2)`,
          [roleId, reviewPerm.rows[0].id],
        );
      }
    }

    for (const permName of OFFICER_PERMS) {
      const permRes = await client.query(
        "SELECT id FROM permission WHERE name = $1 AND tenant_id = $2",
        [permName, tenantId],
      );
      if (permRes.rows.length > 0) {
        for (const roleId of OFFICER_ROLES) {
          await client.query(
            `INSERT INTO role_permission (role_id, permission_id) VALUES ($1, $2)`,
            [roleId, permRes.rows[0].id],
          );
        }
      }
    }

    await client.query(
      `INSERT INTO membership (tenant_id, user_id, organization_id, role_id)
       VALUES ($1, $2, $3, '00000000-0000-0000-0000-000000000501')`,
      [tenantId, adminUserId, orgId],
    );

    // ==========================================
    // Seed Hardened Workflow Configurations
    // ==========================================
    const wfDefId = "00000000-0000-0000-0000-000000000600";
    await client.query(
      `INSERT INTO workflow_definition (id, tenant_id, name, description)
       VALUES ($1, $2, 'facility_registration', 'Facility Environmental Registration Workflow')`,
      [wfDefId, tenantId],
    );

    const wfVerId = "00000000-0000-0000-0000-000000000601";
    await client.query(
      `INSERT INTO workflow_version (id, tenant_id, definition_id, version_number, status, published_at, published_by, configuration_hash)
       VALUES ($1, $2, $3, 1, 'active', NOW(), $4, 'initial-hash-v1')`,
      [wfVerId, tenantId, wfDefId, adminUserId],
    );

    // Seed Workflow Steps
    const steps = [
      {
        id: "00000000-0000-0000-0000-000000000611",
        name: "submission",
        type: "human_review",
        entry: true,
        terminal: false,
      },
      {
        id: "00000000-0000-0000-0000-000000000612",
        name: "ai_review",
        type: "agent_execution",
        entry: false,
        terminal: false,
      },
      {
        id: "00000000-0000-0000-0000-000000000613",
        name: "officer_review",
        type: "human_review",
        entry: false,
        terminal: false,
      },
      {
        id: "00000000-0000-0000-0000-000000000614",
        name: "approved",
        type: "human_review",
        entry: false,
        terminal: true,
      },
      {
        id: "00000000-0000-0000-0000-000000000615",
        name: "rejected",
        type: "human_review",
        entry: false,
        terminal: true,
      },
      {
        id: "00000000-0000-0000-0000-000000000616",
        name: "action_required",
        type: "human_review",
        entry: false,
        terminal: true,
      },
    ];

    for (const step of steps) {
      await client.query(
        `INSERT INTO workflow_step_definition (id, tenant_id, version_id, step_name, step_type, configuration, configuration_schema_version, is_entry_step, is_terminal_step)
         VALUES ($1, $2, $3, $4, $5, '{}', '1.0', $6, $7)`,
        [
          step.id,
          tenantId,
          wfVerId,
          step.name,
          step.type,
          step.entry,
          step.terminal,
        ],
      );
    }

    // Seed Workflow Transitions
    const transitions = [
      {
        from: "00000000-0000-0000-0000-000000000611",
        outcome: "submit",
        to: "00000000-0000-0000-0000-000000000612",
      },
      {
        from: "00000000-0000-0000-0000-000000000612",
        outcome: "ai_complete",
        to: "00000000-0000-0000-0000-000000000613",
      },
      {
        from: "00000000-0000-0000-0000-000000000613",
        outcome: "approve",
        to: "00000000-0000-0000-0000-000000000614",
      },
      {
        from: "00000000-0000-0000-0000-000000000613",
        outcome: "reject",
        to: "00000000-0000-0000-0000-000000000615",
      },
      {
        from: "00000000-0000-0000-0000-000000000613",
        outcome: "request_correction",
        to: "00000000-0000-0000-0000-000000000616",
      },
    ];

    for (const t of transitions) {
      await client.query(
        `INSERT INTO workflow_transition (tenant_id, version_id, from_step_definition_id, outcome_code, to_step_definition_id, condition_expression, priority)
         VALUES ($1, $2, $3, $4, $5, '{}', 1)`,
        [tenantId, wfVerId, t.from, t.outcome, t.to],
      );
    }

    // ==========================================
    // Seed Hardened Workflow Configurations for Complaints
    // ==========================================
    const compWfDefId = "00000000-0000-0000-0000-000000000700";
    await client.query(
      `INSERT INTO workflow_definition (id, tenant_id, name, description)
       VALUES ($1, $2, 'complaint_triage', 'EcoGov Complaint Intake & Triage Workflow')`,
      [compWfDefId, tenantId],
    );

    const compWfVerId = "00000000-0000-0000-0000-000000000701";
    await client.query(
      `INSERT INTO workflow_version (id, tenant_id, definition_id, version_number, status, published_at, published_by, configuration_hash)
       VALUES ($1, $2, $3, 1, 'active', NOW(), $4, 'initial-hash-v1-comp')`,
      [compWfVerId, tenantId, compWfDefId, adminUserId],
    );

    const compSteps = [
      {
        id: "00000000-0000-0000-0000-000000000711",
        name: "intake",
        type: "human_review",
        entry: true,
        terminal: false,
      },
      {
        id: "00000000-0000-0000-0000-000000000712",
        name: "ai_triage",
        type: "agent_execution",
        entry: false,
        terminal: false,
      },
      {
        id: "00000000-0000-0000-0000-000000000713",
        name: "officer_review",
        type: "human_review",
        entry: false,
        terminal: false,
      },
      {
        id: "00000000-0000-0000-0000-000000000714",
        name: "assigned",
        type: "human_review",
        entry: false,
        terminal: true,
      },
      {
        id: "00000000-0000-0000-0000-000000000715",
        name: "rejected",
        type: "human_review",
        entry: false,
        terminal: true,
      },
    ];

    for (const step of compSteps) {
      await client.query(
        `INSERT INTO workflow_step_definition (id, tenant_id, version_id, step_name, step_type, configuration, configuration_schema_version, is_entry_step, is_terminal_step)
         VALUES ($1, $2, $3, $4, $5, '{}', '1.0', $6, $7)`,
        [
          step.id,
          tenantId,
          compWfVerId,
          step.name,
          step.type,
          step.entry,
          step.terminal,
        ],
      );
    }

    const compTransitions = [
      {
        from: "00000000-0000-0000-0000-000000000711",
        outcome: "submit",
        to: "00000000-0000-0000-0000-000000000712",
      },
      {
        from: "00000000-0000-0000-0000-000000000712",
        outcome: "ai_complete",
        to: "00000000-0000-0000-0000-000000000713",
      },
      {
        from: "00000000-0000-0000-0000-000000000713",
        outcome: "assign",
        to: "00000000-0000-0000-0000-000000000714",
      },
      {
        from: "00000000-0000-0000-0000-000000000713",
        outcome: "reject",
        to: "00000000-0000-0000-0000-000000000715",
      },
    ];

    for (const t of compTransitions) {
      await client.query(
        `INSERT INTO workflow_transition (tenant_id, version_id, from_step_definition_id, outcome_code, to_step_definition_id, condition_expression, priority)
         VALUES ($1, $2, $3, $4, $5, '{}', 1)`,
        [tenantId, compWfVerId, t.from, t.outcome, t.to],
      );
    }

    // Record Security bootstrap event in audit trail
    await client.query(
      `INSERT INTO authz_audit_log (tenant_id, user_id, action, resource, result, context)
       VALUES ($1, $2, 'bootstrap', 'system', 'allow', $3)`,
      [tenantId, adminUserId, JSON.stringify({ isInteractive, adminEmail })],
    );

    await client.query("COMMIT");
    console.log(
      "Bootstrap completed successfully. System admin and workflows seeded.",
    );
    process.exit(0);
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Bootstrap execution failed:", error);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}
