-- Rebrand default tenant and organization to Anambra State Ministry of Environment
UPDATE tenant
SET
  name = 'Anambra State Ministry of Environment',
  updated_at = NOW()
WHERE id = '00000000-0000-0000-0000-000000000001'
  AND name IS DISTINCT FROM 'Anambra State Ministry of Environment';

UPDATE organization
SET
  name = 'Anambra State Ministry of Environment Headquarters',
  updated_at = NOW()
WHERE id = '00000000-0000-0000-0000-000000000010'
  AND name IS DISTINCT FROM 'Anambra State Ministry of Environment Headquarters';
