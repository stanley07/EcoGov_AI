-- Phase PA-1.1: Add encrypted_payload column to task_execution
ALTER TABLE task_execution ADD COLUMN encrypted_payload JSONB;
