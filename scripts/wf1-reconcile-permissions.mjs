import pg from "pg";
import { WORKFLOW_PERMISSIONS } from "../modules/govos-core/dist/index.js";
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
try{
 const client=await pool.connect();
 try{
  await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
  const result=await client.query(`INSERT INTO role_permission(role_id,permission_id)
    SELECT r.id,p.id FROM role r JOIN permission p ON p.tenant_id=r.tenant_id
    JOIN tenant t ON t.id=r.tenant_id AND t.status='active'
    WHERE r.name='super_admin' AND p.name=ANY($1)
      AND NOT EXISTS(SELECT 1 FROM role_permission rp WHERE rp.role_id=r.id AND rp.permission_id=p.id)
    RETURNING role_id,permission_id`,[WORKFLOW_PERMISSIONS]);
  const invalid=await client.query(`SELECT count(*)::int count FROM role_permission rp JOIN role r ON r.id=rp.role_id JOIN permission p ON p.id=rp.permission_id WHERE r.tenant_id<>p.tenant_id OR (p.name=ANY($1) AND (p.name LIKE 'platform.%' OR p.name='user:write'))`,[WORKFLOW_PERMISSIONS]);
  if(invalid.rows[0].count)throw new Error('Workflow permission integrity failure');
  await client.query('COMMIT');console.log(JSON.stringify({mappingsCreated:result.rowCount,permissions:WORKFLOW_PERMISSIONS.length}));
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}finally{await pool.end();}
