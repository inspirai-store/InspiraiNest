# Desktop 0.2.1

This patch keeps the shared React layout and existing controls.

- Existing record drafts with an editing ID display `编辑记录`; new drafts retain `新记录`.
- Normal system lifecycle events display `正常`. Active faults and warning/error events retain `待处理`; resolved faults display `已恢复`.
- App manifests advance from 0.2.0 to 0.2.1. Packaged React checks derive their expected version from the app manifest.

## Pre-package validation

- TypeScript strict and Vite production build passed.
- Frontend adapter/state tests: 126 passed, zero failures.
- Native GUI checks used the signed 0.2.0 executable with the rebuilt frontend through its existing test-only frontend path override, production preload and real loopback REST services. This is separate from final signed 0.2.1 installation acceptance.
- A disconnected service port allowed local saving of text, a three-page PDF and a video. After quitting and relaunching while still disconnected, the record and both local attachments remained readable. PDF page 2 rendered; the video decoded, advanced and paused. Reconnecting and retrying created one server record, version 1, with matching attachment hashes and zero processing tasks.
- Archive body links opened a server PDF, rendered page 2, and played/paused the server video.
- A fresh stable configuration passed A -> B -> A: B had no A records or draft, B library search did not inherit A's filter, each space retained its own saved record, and A's unsaved draft returned. The first fixture run was discarded for account acceptance because restarting the test harness had reset its worker configuration; the reusable fixture now preserves its existing configuration on restart.
- Native diagnostics displayed neutral lifecycle events, an active fault and a resolved fault with distinct labels.

`collector/scripts/native-records-regression.mjs` starts disposable loopback REST services and synthetic PDF/video fixtures for manual Cua interaction. It does not automate UI, replace preload, replace safeStorage, or use production identity/data. Its optional `NATIVE_REGRESSION_ROOT` resumes the same fixture ports, stores and configuration.

## Delivery boundaries

The signed/notarized package build, final local installation and protected-data comparison are recorded separately in the local delivery report. CI must succeed before replacing the installed app. Windows/Intel device acceptance and physical camera/microphone tests are outside this Mac patch acceptance.
