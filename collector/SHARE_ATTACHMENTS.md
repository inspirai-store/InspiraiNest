# Android share inputs

Android accepts text, `EXTRA_STREAM` and `ClipData` together for both share actions. Supported files start selected. The document/image/audio filters only change visibility; selection determines the submitted input. File names are display metadata, and private paths derive from independent UUIDs.

Supported: TXT, Markdown, PDF, DOCX; JPEG, PNG, WebP, GIF; MP3, M4A, AAC, WAV, OGG, FLAC, audio WebM. Limits: 32 MiB per file, 128 MiB and 20 selected files per task. Video, ZIP and legacy Office formats are excluded.

The app copies URI streams while permission is available, checks the actual byte count and SHA-256, and saves selection in its existing drafts. A selected unreadable input blocks submission. Shared `content://` identifiers never become task prose. A submission may contain files with no text.

The existing SQLite outbox keeps its identity and immutable task JSON. Binary uploads run before task creation. Private atomic upload receipts retain individual confirmations and aggregate progress; a HEAD request recovers a lost upload acknowledgement without resending the file. Restarted delivery uses the same submission ID. Removing a local queue item removes its private copies but does not cancel a remote task.

## Protocol

- `PUT /api/records/media/:sha256`: owner-only, binary data, supported MIME and signature validation. Documents reuse the private object store. Recognizable encrypted Word packages remain inputs even if their contents cannot be extracted.
- `HEAD /api/records/media/:sha256`: owner-only upload confirmation with length, type and `X-Content-SHA256`.
- `POST /api/tasks`: optional `attachments: [{id, name, sha256}]`. The server resolves immutable `inputAttachments` with MIME and byte count from uploaded objects. Ordered attachment references participate in submission idempotency. Changing them requires a new ID.
- `GET /api/tasks/:id/input-files/:sha256`: owners, or the current active assigned Worker with `X-Task-Assignment`; non-members, stale assignments, cancellation and revocation are rejected.
- Worker heartbeat `inputAttachmentProtocol: 1`: required for attachment dispatch, including explicit retries. Older Workers retain text tasks.
- `GET /api/archives/:id/input-files/:sha256`: owner-only original download, subject to archive visibility and current authorization.

## Worker and results

`.task-input/manifest.json` lists original names, IDs, types, sizes, hashes and complete local file paths. Hash-verified originals remain in this task directory. TXT/Markdown are normalized to UTF-8; DOCX paragraph/table text is pre-extracted as a preview. Preview failures retain the original for Agent inspection. The Agent checks complete documents, does OCR for images/scanned PDF and uses available local ASR for audio.

One input set produces one consolidated entry. Extracted text, transcripts, summaries and source locations use the existing lightweight archive. Original DOCX/audio and other raw inputs live separately in object storage, so they do not consume the archive's 40 MiB budget.

Before publishing, the Worker verifies `collector-input-result.json`:

```json
{"schemaVersion":1,"attachments":[{"id":"input UUID","sha256":"input hash","status":"parsed","files":["extracted/input.txt"]}]}
```

Every frozen input must have at least one non-empty, registered text/transcript file inside the result entry. Missing coverage pauses the task and retains its directory. Missing attachment tools and encrypted/unreadable input reported by the Agent also pause on the original computer. Explicit retry reuses the same task directory. The server supplies the final original list from the frozen task rather than trusting Agent metadata.

`inputAttachments` accompanies archives and review results. Android exposes originals through native authenticated transport; DOCX supports saving/external opening, audio supports playback, and PDF uses the existing reader. Neither object credentials nor device tokens enter page scripts.

## Verification

`test/input-attachments.test.mjs` checks document encoding, DOCX table extraction, input limits, immutable retries, capability dispatch, access fences, corruption recovery, incomplete coverage, continuation and manual approval. `InputFilesTest` covers mixed share inputs and selection. On-device `CoreTest` checks lost binary-upload and task-creation confirmations; `InputShareFlowTest` checks the actual share UI, filtering, copied originals and restored selection after source removal.

Physical file-manager, WPS and recorder sharing must be checked on a phone because URI grants and provider behavior can vary by application and device.
