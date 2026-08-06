# WF-2 Template Versioning

Status: Approved with required review changes incorporated

## Ownership model

| Ownership         | Namespace and authority                                                                                                   | Tenant behavior                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Platform-owned    | `platform/<semantic_key>`; platform notification publisher only                                                           | Tenant may bind and use; override only when `allow_tenant_override=true`; mandatory/legal platform content may forbid override |
| Application-owned | `<application_key>/<semantic_key>`; application owner proposes, platform notification publisher publishes catalog version | Tenant binds a published version and may create an approved tenant override                                                    |
| Tenant-owned      | `<tenant_id>/<application_key>/<semantic_key>`; exact tenant template permissions                                         | Never visible or usable by another tenant; optional organization-specific binding                                              |

Application ownership is a namespace/content ownership concept, not runtime authority. Application code cannot publish by writing the database or choose an unreviewed template version.

## Lifecycle

Exact version states are `draft`, `validating`, `published`, and `deprecated`.

- `draft -> validating`: freezes the submitted validation candidate by expected version.
- `validating -> draft`: validation failed; store bounded redacted report.
- `validating -> published`: validation succeeded for the exact content hash and publisher is authorized.
- `published -> deprecated`: stops new bindings/requests; existing pinned requests and deliveries continue.
- No other transition is allowed. `deprecated -> published` is forbidden.

Published versions are immutable, including variable schema, channel renderings, locale, sender profile key, classification, security flags, and content hash. Lifecycle timestamps, status, and binding/default rotation are the only approved post-publication mutations. Default rotation is atomic between published versions and cannot create zero or multiple defaults where a required binding exists. Rotation locks the binding and candidate version and proves the candidate version's parent template owns the exact `application_key` and `semantic_key`; a published version for another semantic key is rejected even if ownership and channel otherwise match.

## Rendering language

- Logic-less variable interpolation with escaped output by default.
- Approved formatters are closed, deterministic, locale-aware functions such as date, number, currency, and safe URL display.
- No `eval`, `Function`, JavaScript, SQL, shell, dynamic import, remote include, arbitrary helper registration, filesystem access, provider SDK call, or network fetch.
- Variable paths are declared in `variable_schema`, use own-property traversal, and block `__proto__`, `prototype`, and `constructor`.
- Email HTML uses an allowlisted sanitizer and URL scheme policy. SMS is text only. Webhook rendering produces schema-validated JSON, not string-concatenated JSON.
- Rendering has byte, node, loop-free expansion, variable-count, and execution-time bounds. Missing required variables fail publication tests and runtime rendering; approved optional variables use explicit defaults.

## Publication validation

Publication must verify:

- exact ownership/permission and expected version;
- unique semantic key/version and valid binding compatibility;
- schema syntax, bounded depth/size, declared variables, required/optional semantics;
- every enabled channel has an approved rendering and content type;
- rendering compiles deterministically with no unknown helper/path/field;
- HTML and URL safety; SMS segment/length cap; webhook JSON schema;
- legal footer/mandatory content requirements;
- data classification does not exceed channel/provider policy;
- locale fallback is explicit and finite;
- sender profile exists and is verified;
- sample fixtures render without secrets and produce the recorded canonical hash.

## Resolution and pinning

Resolution order is exact organization binding, tenant default binding, approved application/platform binding. The resolver never scans arbitrary global templates. The selected published `template_version_id`, binding ID/version, locale, route hash, and rendered-content hash are pinned to the request/delivery evidence. Later publication or default rotation cannot affect an accepted request.

## Compatibility

The current invitation subject and safe body become the initial application-owned invitation template. The activation URL/token remain protected variables and are never exposed by list/detail/audit operations. Compatibility tests must prove equivalent recipient, route, secure content, task identity, and development-mailbox behavior before legacy hard-coded rendering is retired.
