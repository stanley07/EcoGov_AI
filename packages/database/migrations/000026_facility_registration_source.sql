-- Migration 000026: Facility Registration Source & Actor Provenance
ALTER TABLE facility ADD COLUMN IF NOT EXISTS registration_source VARCHAR(50);
ALTER TABLE facility ADD COLUMN IF NOT EXISTS registered_by_user_id UUID REFERENCES user_account(id) ON DELETE RESTRICT;
ALTER TABLE facility ADD COLUMN IF NOT EXISTS registered_by_subcontractor_id UUID REFERENCES subcontractor_profile(id) ON DELETE RESTRICT;

-- Backfill existing facility rows using created_by field only if it exists in user_account
UPDATE facility f
SET registration_source = 'officer',
    registered_by_user_id = f.created_by
FROM user_account u
WHERE f.created_by = u.id;

-- Fallback to legacy for all other records
UPDATE facility
SET registration_source = 'legacy'
WHERE registration_source IS NULL;

-- Apply constraints to facility
ALTER TABLE facility ALTER COLUMN registration_source SET NOT NULL;
ALTER TABLE facility ADD CONSTRAINT chk_facility_registration_source CHECK (
  registration_source IN ('officer', 'subcontractor', 'import', 'integration', 'legacy')
);

ALTER TABLE facility ADD CONSTRAINT chk_facility_provenance CHECK (
  (registration_source = 'officer' AND registered_by_user_id IS NOT NULL AND registered_by_subcontractor_id IS NULL) OR
  (registration_source = 'subcontractor' AND registered_by_subcontractor_id IS NOT NULL AND registered_by_user_id IS NULL) OR
  (registration_source = 'import' AND registered_by_user_id IS NOT NULL) OR
  (registration_source = 'integration') OR
  (registration_source = 'legacy')
);

-- facility_registration submission metadata
ALTER TABLE facility_registration ADD COLUMN IF NOT EXISTS submitted_by_actor_type VARCHAR(50);
ALTER TABLE facility_registration ADD COLUMN IF NOT EXISTS submitted_by_actor_id UUID;
ALTER TABLE facility_registration ADD COLUMN IF NOT EXISTS submission_channel VARCHAR(50);

-- Backfill existing registrations
UPDATE facility_registration
SET submitted_by_actor_type = 'officer',
    submitted_by_actor_id = submitted_by,
    submission_channel = 'web_portal'
WHERE submitted_by IS NOT NULL;

-- Apply constraints to facility_registration
ALTER TABLE facility_registration ADD CONSTRAINT chk_submitted_by_actor_type CHECK (submitted_by_actor_type IN ('officer', 'subcontractor'));
ALTER TABLE facility_registration ADD CONSTRAINT chk_submission_channel CHECK (submission_channel IN ('web_portal', 'mobile_app', 'bulk_import', 'api'));
