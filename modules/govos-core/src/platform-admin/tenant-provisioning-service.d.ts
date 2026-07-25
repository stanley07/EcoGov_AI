import { Pool } from "pg";
import { z } from "zod";
export declare const ProvisionTenantInputSchema: z.ZodObject<{
    name: z.ZodString;
    slug: z.ZodString;
    type: z.ZodEnum<["ministry", "agency", "department"]>;
    adminEmail: z.ZodString;
    adminName: z.ZodString;
    region: z.ZodOptional<z.ZodString>;
    lga: z.ZodOptional<z.ZodString>;
    primaryColor: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    name: string;
    slug: string;
    type: "ministry" | "agency" | "department";
    adminEmail: string;
    adminName: string;
    region?: string | undefined;
    lga?: string | undefined;
    primaryColor?: string | undefined;
}, {
    name: string;
    slug: string;
    type: "ministry" | "agency" | "department";
    adminEmail: string;
    adminName: string;
    region?: string | undefined;
    lga?: string | undefined;
    primaryColor?: string | undefined;
}>;
export type ProvisionTenantInput = z.infer<typeof ProvisionTenantInputSchema>;
export declare class TenantProvisioningService {
    private pool;
    constructor(pool: Pool);
    /**
     * Safe entrypoint handling idempotency lookup, recovery, and routing.
     */
    provision(actorUserId: string, idempotencyKey: string, rawInput: unknown): Promise<{
        status: number;
        payload: any;
    }>;
}
//# sourceMappingURL=tenant-provisioning-service.d.ts.map