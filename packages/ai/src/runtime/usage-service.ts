import { Pool } from "pg";

export interface ReserveUsageParams {
  tenantId: string;
  executionId: string;
  policyVersion: string;
  reservedInputTokens: number;
  reservedOutputTokens: number;
  reservedCostMicrounits: bigint;
  timeoutSeconds: number;
}

export class UsageAccountingService {
  constructor(private pool: Pool) {}

  public async reserveUsage(params: ReserveUsageParams): Promise<string> {
    const expiresAt = new Date(Date.now() + params.timeoutSeconds * 1000);
    const res = await this.pool.query(
      `INSERT INTO ai_usage_reservation (
         tenant_id, ai_execution_id, policy_version, reserved_input_tokens, reserved_output_tokens,
         reserved_cost_microunits, status, created_at, expires_at
       ) VALUES ($1, $2, $3, $4, $5, $6, 'reserved', NOW(), $7) 
       RETURNING id`,
      [
        params.tenantId,
        params.executionId,
        params.policyVersion,
        params.reservedInputTokens,
        params.reservedOutputTokens,
        params.reservedCostMicrounits.toString(),
        expiresAt,
      ]
    );
    return res.rows[0].id;
  }

  public async releaseUsage(reservationId: string): Promise<void> {
    await this.pool.query(
      `UPDATE ai_usage_reservation 
       SET status = 'released', reconciled_at = NOW() 
       WHERE id = $1 AND status = 'reserved'`,
      [reservationId]
    );
  }

  public async reconcileUsage(reservationId: string, actualCost: bigint): Promise<void> {
    await this.pool.query(
      `UPDATE ai_usage_reservation 
       SET status = 'charged', actual_cost_microunits = $1, reconciled_at = NOW() 
       WHERE id = $2 AND status = 'reserved'`,
      [actualCost.toString(), reservationId]
    );
  }

  public async reclaimExpiredReservations(): Promise<void> {
    await this.pool.query(
      `UPDATE ai_usage_reservation 
       SET status = 'expired', reconciled_at = NOW() 
       WHERE status = 'reserved' AND expires_at < NOW()`
    );
  }
}
