import { Pool } from "pg";

/**
 * Checks whether the current time is within quiet hours for a user (or tenant default).
 * Note: Emergency notifications bypass quiet hours.
 */
export async function checkQuietHours(
  tenantId: string,
  userId: string | null,
  _channel: string,
  dbPool: Pool,
  bypassQuietHours: boolean = false,
): Promise<boolean> {
  if (bypassQuietHours) {
    return false; // Emergencies bypass quiet hours
  }

  try {
    // Look for user-specific quiet hours first, fallback to tenant-wide default
    let query = `
      SELECT start_hour, start_minute, end_hour, end_minute, timezone
      FROM notification_quiet_hours
      WHERE tenant_id = $1 AND user_id = $2
    `;
    let params: any[] = [tenantId, userId];

    if (!userId) {
      query = `
        SELECT start_hour, start_minute, end_hour, end_minute, timezone
        FROM notification_quiet_hours
        WHERE tenant_id = $1 AND user_id IS NULL
      `;
      params = [tenantId];
    }

    let res = await dbPool.query(query, params);

    if (res.rows.length === 0 && userId) {
      // Fallback to tenant-wide default if user-specific settings are missing
      query = `
        SELECT start_hour, start_minute, end_hour, end_minute, timezone
        FROM notification_quiet_hours
        WHERE tenant_id = $1 AND user_id IS NULL
      `;
      res = await dbPool.query(query, [tenantId]);
    }

    if (res.rows.length === 0) {
      return false;
    }

    const { start_hour, start_minute, end_hour, end_minute } = res.rows[0];

    // Evaluate in UTC
    const now = new Date();
    const currentHour = now.getUTCHours();
    const currentMin = now.getUTCMinutes();

    const currentTotalMins = currentHour * 60 + currentMin;
    const startTotalMins = start_hour * 60 + start_minute;
    const endTotalMins = end_hour * 60 + end_minute;

    if (startTotalMins < endTotalMins) {
      return (
        currentTotalMins >= startTotalMins && currentTotalMins <= endTotalMins
      );
    } else {
      // spans midnight
      return (
        currentTotalMins >= startTotalMins || currentTotalMins <= endTotalMins
      );
    }
  } catch (err) {
    return false;
  }
}
