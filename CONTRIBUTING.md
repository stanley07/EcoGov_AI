# Contributing Guidelines for GovOS AI & EcoGov AI

## Monorepo Standards

This project is configured as a modular monorepo using `npm workspaces`.

### Folder structure

- `apps/`: Independent deployable targets (Web, API, Worker).
- `packages/`: Shared libraries with strict public boundaries (compiled via typescript project references).

### Import policies

- Use workspace names to refer to libraries, e.g., `import { ... } from "@govos/domain"`.
- **Never** use relative imports spanning across package boundaries, e.g., `import ... from "../../../packages/domain/src"`.
- Avoid importing deep package internals. Only consume public exports defined in `exports` fields of package configs.

### Code quality

- Format code with Prettier before commit (`npm run format:write`).
- Ensure strict lint compliance (`npm run lint`).
- Verify dependency-cruiser boundary rules (`npm run architecture:check`).
