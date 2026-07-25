# Security Policy

## Vulnerability Disclosure

For any potential security flaws, please email the security team directly at `security@govos.ai` instead of opening a public issue.

## Core Security Controls

1.  **Tenancy Isolation**: Database updates must rely on PostgreSQL Row-Level Security (RLS) policies.
2.  **PII Privacy**: Complainant details must be masked in public listings.
3.  **Task Authentication**: Worker routes in production require Google OIDC authentication checks.
4.  **Secret Management**: Secrets must never be hardcoded or checked into repository sources. Always use GCP Secret Manager in staging/production environments.
