# Implementation Todo List

Phases 1–3 (flat-file SDK, test infrastructure, interactive runner) and the
JavaScript SDK redesign (OOP data layer, interface-only `IApiSdk`/`createApiSdk`,
tests-in-build, the SDKCLI TUI, `usageCase.js`, CI) are **complete** — see
[README.md](README.md) for the current architecture. Only the work below remains.

## Phase 4: OTA API Integration

> The interface seam already exists: an OTA reader/client plugs into the same
> OOP graph behind the same `IApiSdk` contract, so consumers won't change.
> The flat-file side abstracts reads through `IFlatFileReader`; the API side
> should mirror that (e.g. an `IOtaClient`) feeding the same entity graph.

### 4.1 API Interface Design
[   ] : 4.1.1 Design SDK interface for API calls
[   ] : 4.1.2 Define API endpoint configuration
[   ] : 4.1.3 Create error handling for API operations
[   ] : 4.1.4 Design authentication and authorization mechanisms

### 4.2 .NET Implementation
[   ] : 4.2.1 Implement HTTP client for API calls
[   ] : 4.2.2 Add API endpoint configuration
[   ] : 4.2.3 Implement request/response handling
[   ] : 4.2.4 Add authentication support
[   ] : 4.2.5 Create unit tests for API operations

### 4.3 JavaScript Implementation
[   ] : 4.3.1 Implement HTTP client for API calls (fetch/axios)
[   ] : 4.3.2 Add API endpoint configuration
[   ] : 4.3.3 Implement request/response handling
[   ] : 4.3.4 Add authentication support
[   ] : 4.3.5 Create unit tests for API operations

### 4.4 Integration Testing
[   ] : 4.4.1 Test API calls with .NET console app
[   ] : 4.4.2 Test API calls with the JavaScript SDK / SDKCLI
[   ] : 4.4.3 Validate error handling and network failure scenarios
[   ] : 4.4.4 Test authentication and authorization flows
