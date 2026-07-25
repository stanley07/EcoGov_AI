export var RegistryErrorCode;
(function (RegistryErrorCode) {
    RegistryErrorCode["APPLICATION_NOT_FOUND"] = "APPLICATION_NOT_FOUND";
    RegistryErrorCode["AGENT_DEFINITION_NOT_FOUND"] = "AGENT_DEFINITION_NOT_FOUND";
    RegistryErrorCode["PROMPT_VERSION_NOT_FOUND"] = "PROMPT_VERSION_NOT_FOUND";
    RegistryErrorCode["OUTPUT_CONTRACT_VERSION_NOT_FOUND"] = "OUTPUT_CONTRACT_VERSION_NOT_FOUND";
    RegistryErrorCode["TOOL_VERSION_NOT_FOUND"] = "TOOL_VERSION_NOT_FOUND";
    RegistryErrorCode["MISMATCHED_APPLICATION_OWNERSHIP"] = "MISMATCHED_APPLICATION_OWNERSHIP";
    RegistryErrorCode["INVALID_JSON_SCHEMA"] = "INVALID_JSON_SCHEMA";
    RegistryErrorCode["INVALID_CONTENT_HASH"] = "INVALID_CONTENT_HASH";
    RegistryErrorCode["LIMITS_EXCEED_PLATFORM_MAX"] = "LIMITS_EXCEED_PLATFORM_MAX";
    RegistryErrorCode["INVALID_STATE_TRANSITION"] = "INVALID_STATE_TRANSITION";
    RegistryErrorCode["IMMUTABLE_RECORD_MUTATION"] = "IMMUTABLE_RECORD_MUTATION";
    RegistryErrorCode["RETIRED_VERSION_REPLAY_REJECTED"] = "RETIRED_VERSION_REPLAY_REJECTED";
    RegistryErrorCode["REFERENCED_VERSION_NOT_ACTIVE"] = "REFERENCED_VERSION_NOT_ACTIVE";
    RegistryErrorCode["ACTIVATION_FAILED"] = "ACTIVATION_FAILED";
})(RegistryErrorCode || (RegistryErrorCode = {}));
export class RegistryError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "RegistryError";
        this.code = code;
    }
}
//# sourceMappingURL=registry-error-codes.js.map