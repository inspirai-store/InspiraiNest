# Capability and task diagnostic contract v1

The core owns capability evaluation, execution identities and sanitized diagnostic persistence. Collection and writing publish facts through their existing Worker boundary. No plugin storage permissions are broadened.

## Identity and recovery

- `taskId` identifies the original submission; a claim creates an `attemptId` bound to the execution device. Reassignment or explicit retry creates a child attempt.
- `runId` identifies the Worker process. It does not change the original task or frozen input/tool version.
- Browser takeover and release append confirmed gate events. They do not retry, replace or reroute a task.
- A queued routing evaluation is a decision record, not an executed attempt. History is append-only; late events may attach to the original attempt but cannot change current task state.

## Capabilities

`capture.article`, `capture.media`, `capture.browser`, `writing.materials` and `writing.selection` are evaluated independently for each execution provider. Availability and verification are separate. A successful result counts only for the matching client, runtime/profile/Skill fingerprint. Permission observations are scoped to provider and collection/writing mode. Source authentication is task-local.

`GET /api/devices/:deviceId/capabilities` is owner/diagnostic-reader only. An owner may queue an isolated permission sample at `POST .../capabilities/check`. Samples run in the Worker environment while idle, write only a synthetic result and never launch or focus a browser. A sample alone does not verify the whole workflow. Old clients without capability facts retain their original dispatch protocol.

## Diagnostic transport

`POST /api/tasks/:taskId/diagnostics` accepts at most 30 events, authenticated by the attempt's bound Worker. Stable event IDs make an identical replay idempotent and conflicting content a 409. Local JSON outbox files survive process restart; only acknowledged batches are removed. The final flush includes events appended during an in-flight batch.

Only allowlisted scalar details and saved-file metadata/hashes synchronize. Source/writing bodies, arbitrary stdout, prompts, cookies and credentials do not. Raw logs and original files remain in their original local storage. Saved file metadata is never described as analyzed coverage.

## Read-only API and CLI

`diagnostics:read` uses explicit existing device authorization and its own OS secure-store slot. It never falls back to `library:read`, owner or Worker credentials. Both scopes retain expiry and revocation checks.

- `GET /api/read/v1/tasks?state=&device=&limit=&cursor=`
- `GET /api/read/v1/tasks/:taskId`
- `GET /api/read/v1/tasks/:taskId/diagnostics`
- `GET /api/read/v1/tasks/:taskId/events?attempt=&limit=&cursor=`
- `GET /api/read/v1/tasks/:taskId/evidence/:eventId`

All task commands are read-only. Diagnosis returns recorded facts, provenance, evidence IDs, completeness and deterministic recovery conditions. It does not call a model to infer a cause. Old histories without reliable attempt identities are explicitly incomplete. Completeness concerns the structured diagnostic stream, not the full local raw log.

The `lingnest-library`, collection and current writing Skills reference the same diagnostic reading workflow. Previous writing bundles remain frozen and advertised alongside the new bundle, so existing task snapshots retain a matching implementation.

## Evidence layers

Source/unit tests, synthetic Electron UI, signed packaging, production service readback and human-operated installed-client acceptance are distinct. Simulated Windows metadata and cross-compilation do not establish Windows runtime acceptance.
