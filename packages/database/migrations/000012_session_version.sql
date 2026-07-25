-- Phase PA-1.1: Add session_version column to session table
ALTER TABLE session ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1;
