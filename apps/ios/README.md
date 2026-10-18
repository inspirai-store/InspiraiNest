# 灵藏 · InspiraiNest iOS

本目录是公开仓库 `inspirai-store/InspiraiNest` 的 iOS 客户端，以 `main` 为维护分支。
当前配置为 **1.0.0（3）、iPhone、iOS 16.0+**，包含主应用、系统分享扩展和 XCTest。
原工程名 `PersonalLibrary`、已有配对协议名及后端路由保持兼容。

扫码配对、阅读首页、分享链接和预览图兼容修复已在公开提交 `e15dec6` 合入。
2026-10-04 的逐项迁移分析和验证见 [合并复核](../../../docs/IOS_MIGRATION_REVIEW_2026-10-04.md)。
[Mac 构建记录](MAC-BUILD-2026-09-26.md) 和 [签名记录](SIGNING-2026-09-26.md)
是 **0.1.0（1）旧版本的历史材料**，不证明当前公开版本已签名、已完成真机验收或已提交 Apple 审核。
当前发布配置及外部待办见 [iOS 发布说明](../../../docs/IOS_APP_STORE_RELEASE.md)。

## Contents

- `project.yml`: XcodeGen project with an iOS app, embedded real `com.apple.share-services`
  extension and hosted XCTest target; minimum iOS 16, iPhone, Swift 5 language mode.
- `App/`: SwiftUI pairing, tasks and event progress, retry/cancel, draft review and
  approval, device revocation, local outbox, protected WKWebView reader, native
  archive attachment browsing with PDFKit/image/text previews; grouped device
  authorization and device identity reporting.
- `ShareExtension/`: UIKit extension entry point hosting SwiftUI, all-item
  `NSItemProvider` capture and Safari preprocessing, optional additional requirements,
  auto-archive, tags, collapsed computer/Agent selectors, save-before-send lifecycle.
- `Shared/`: immutable request models, owner-device Keychain credential, HTTPS API,
  SQLite App Group outbox and cached dispatch choices. These files compile directly
  into **each** executable; neither executable links the other one's Swift module.
- `Config/`: separate Info.plists, common entitlements, local signing configuration example.
- `Tests/`: XCTest sources for payload preservation/limits, origin/cookie policy,
  durable outbox and leases, cached choices, pairing and task API requests.
- `scripts/check_contract.py`: runnable Windows/macOS checks, including independent
  OS processes exercising SQL extracted from the actual Swift implementation.

## Reproduce the project on a Mac

Use Xcode 16 or newer, its selected command-line tools, and XcodeGen 2.42 or newer.
The project has no third-party Swift packages. SQLite3, CryptoKit, WebKit, PDFKit,
SwiftUI, UniformTypeIdentifiers and Security come from Apple's SDK.

```sh
cd collector/mobile/ios
# Install XcodeGen through your normal package-management workflow if absent:
brew install xcodegen
cp Config/Local.xcconfig.example Config/Local.xcconfig
```

Edit `Config/Local.xcconfig` with **your** identifiers:

```xcconfig
DEVELOPMENT_TEAM = YOURTEAMID
COLLECTOR_BUNDLE_ID = your.registered.personalLibrary
COLLECTOR_APP_GROUP = group.your.registered.personalLibrary
COLLECTOR_KEYCHAIN_SUFFIX = your.registered.personalLibrary.shared
```

Register the application ID and `<application ID>.share` with the same Apple team.
Enable App Groups and Keychain Sharing for **both**. Register the App Group and
assign it to both targets' provisioning profiles. The effective Keychain access
group must be `$(AppIdentifierPrefix)$(COLLECTOR_KEYCHAIN_SUFFIX)` on both targets;
the App Identifier Prefix is not necessarily the team ID. The Info.plist values
and entitlements use the same build variables, with no hardcoded real team or token.
Use an account/profile that supports App Groups. Missing entitlements are a visible
save/credential error; there is no insecure fallback to app-local UserDefaults.

```sh
xcodegen generate --spec project.yml
xcodebuild -list -project PersonalLibrary.xcodeproj
xcodebuild -showdestinations -project PersonalLibrary.xcodeproj -scheme PersonalLibrary
open PersonalLibrary.xcodeproj
```

Select the **PersonalLibrary** scheme and an available iPhone simulator, then build.
For a repeatable command-line check, replace the destination with a simulator UDID
from the previous command:

```sh
xcodebuild -project PersonalLibrary.xcodeproj -scheme PersonalLibrary \
  -configuration Debug -destination 'platform=iOS Simulator,id=YOUR_SIMULATOR_UDID' \
  -derivedDataPath DerivedData CODE_SIGNING_ALLOWED=NO build

xcodebuild -project PersonalLibrary.xcodeproj -scheme PersonalLibrary \
  -configuration Debug -destination 'platform=iOS Simulator,id=YOUR_SIMULATOR_UDID' \
  -derivedDataPath DerivedData -resultBundlePath TestResults.xcresult \
  CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- test
```

Use ad-hoc signing for the simulator test host: the device-identity tests exercise
Keychain access, which fails in an unsigned host. This simulator signature is not
an Apple development or App Store distribution signature.

Choose a fresh result-bundle path for another run. Simulator builds do not prove
real-device Keychain/App Group provisioning or Share Sheet activation. Install the
app on a signed iPhone and enable **保存到灵藏** in the system Share Sheet's More
menu. Run the containing app once to pair or share before pairing to test offline
capture. A signing-capable Mac is also required to archive/distribute an IPA.

`Local.xcconfig`, generated `.xcodeproj`, DerivedData and `.xcresult` are ignored
inside this directory. Do not put credentials into any signing/build file. App Store
distribution still requires registered signing capabilities, your privacy declarations
and release review. The AppIcon asset is included in the current repository.

## Pairing and security

The default pairing entry scans the **one-time phone/owner QR code** from the
management page, using the camera or an image from Photos. The QR contains the
HTTPS server origin, one-time code, role and expiry; the app validates these
fields locally and displays the destination server for confirmation before
pairing. Camera access is requested only when scanning. The manual section
remains available for an address and owner code or personal key; its default
address is empty until the user enters their own HTTPS library origin.
`POST /api/pair` sends **`key` and `name`**, `clientType="ios"`, and device
identity/information when available; the response must have
`device.role == "owner"` and a UUID device ID. A worker code is rejected without
persisting its token. The backend consumes a pairing code before this role check;
generate a new owner code if the wrong kind was used.

Device metadata is refreshed through `POST /api/devices/me/info`. Computer choices use
`Device.canDispatch`, including desktop devices with worker authorization;
the legacy `role="worker"` flag also remains compatible.

The pairing code or personal key exists only in the temporary exchange request and is cleared from the UI
when submitted. Only the returned, individually revocable device credential is
stored, as one atomic Keychain item containing origin/device/name/token. It uses
the explicit shared access group, `AfterFirstUnlockThisDeviceOnly`, and disables
synchronization. No master/personal key, pairing key or bearer is stored in UserDefaults,
SQLite, URLs, JavaScript, app logs or a credentials file. This is the backend's
existing **owner device scope**, not a new restricted read-only server role.

The API accepts HTTPS root origins only: no username/password, query, fragment,
non-root path or HTTP exception. Standard OS certificate/hostname validation and
ATS remain enabled. Invalid/self-signed certificates are not bypassed. All API
redirects are refused, including same-origin redirects. Requests use ephemeral
URLSession storage with cookie handling and URL cache disabled. Error messages do
not echo response bodies, headers, pairing keys or Foundation network error details.

Removing local login deletes the Keychain credential and tears down the reader;
it does not remotely revoke the device. The device list has a separate confirmed
revoke operation. Revoking this device clears local login after server confirmation.
The next 401 while refreshing invalidates the native reader and asks for pairing.
Local originals are intentionally retained, including after logout/revocation.

## Sharing, exact preservation, and dispatch

Capture enumerates **all** `NSExtensionItem`s and their providers, preserving supplied
attributed-title/content strings, provider suggested names, text and URL
representations, and Safari's document title/selected text/current URL. It does not
extract only the first URL, trim the original strings, deduplicate repetitions,
rewrite URL queries/fragments, summarize the original, or replace it with added
requirements. Rich text styling is not retained; the supplied text value is.
Link Presentation metadata also supplies its original URL and title when available.
Some apps include a thumbnail or another binary preview alongside the link. The
extension keeps the text and link, explicitly warns that those attachments were
not collected, and refuses an attachment-only share without text or a URL.

The local `originalParts` array preserves exact strings with item, attachment, kind
and representation provenance. Submission `content` joins the original values with
two newlines, then appends `\n\n【附加要求】\n` and the untouched optional requirements.
The requirements also have their own local field. This can contain duplicate
representations when the source app supplies the same text more than once;
preservation takes precedence over deduplication.

Defaults: `type="auto"`, `autoArchive=true`, tags `[]`, computer and Agent automatic
(omitted/null optional fields). The collapsed **高级派发选项** section offers computer
selection, Codex and CodeBuddy. When paired it fetches `/api/state`, caching only
nonsecret device metadata by origin in SQLite. Offline it shows the cached options.
The selected computer/Agent, tags and auto-archive flag become part of the immutable
saved request. A disappearing/revoked/offline computer is **not** silently replaced
by auto. The server may reject a revoked target; the full submission remains local.

Saving always commits the complete local item before any POST. Without credentials,
the original and settings are saved unbound. The extension says **已保存，尚未提交**;
the main app lets the user pair and explicitly bind that item to the current server.
If credentials disappear/change while the sheet is open, the displayed choices'
origin remains attached to the saved record and no wrong-server submission occurs.
There is no forced app launch, `UIApplication.shared`, responder-chain workaround,
custom URL credential handoff, or automatic copying to the clipboard.

After persistence, the extension attempts a foreground request with a 10-second
resource/request limit if an appropriate credential exists. **完成** calls
`completeRequest` only after successful persistence and the attempt's return. Before
save, **取消** calls `cancelRequest`. Extraction failures/timeouts show **尚未保存**;
completion stays unavailable so the user can retry capture or cancel back to the
host. Unsupported binary/file-only shares are rejected explicitly, not silently
treated as complete. If the system kills the extension before saving, it cannot
recover unread provider data; after SQLite commit the original is durable.

## Outbox and retry contract

The App Group contains `Outbox/outbox.sqlite` with one row per immutable submission,
not a shared read/modify/write JSON array. WAL, FULL synchronization, a busy timeout
and `BEGIN IMMEDIATE` coordinate separate app/extension processes. A lease claim
and attempt increment are atomic. Network traffic never holds a SQLite transaction.
Each send lease expires after 90 seconds, comfortably exceeding the bounded request.
Finishing updates only a matching lease ID, so a late completion cannot overwrite
another attempt. A crash rolls back an incomplete write; expired sends can retry.
The shared directory is protected until first unlock and excluded from backup.

- A UUID is generated **once per saved share**; every retry sends the identical
  `submissionId` and payload. The service's `common.mjs` also uses UUID task/device IDs.
- An HTTP 200 or 201 is accepted only with a valid task UUID and matching returned
  `submissionId`; only then is the outbox state `submitted`.
- Timeout/lost response can mean the server accepted the task. Retry the same item;
  do not re-share or generate another UUID to “fix” an ambiguous outcome.
- 400/403/409/413/422 or local validation failures remain visible and preserved.
  No truncation, silent splitting, settings fallback or automatic new task occurs.
- `/api/tasks` limits `content` to 10,000 **UTF-16 units**, each tag to 60 units, 20
  tags, and the body to 96 KiB. Oversized originals still save locally and remain
  selectable/copyable; submission is blocked instead of discarding content.
- Items are pinned to one origin; unbound items require explicit binding. A login
  to another server never reroutes existing submissions. Re-pairing to the same
  origin retains the same ID, matching the backend's global submission deduplication.
- The main app offers per-item retry and explicit retry of queued items. It does
  not continuously retry errors, auto-delete originals, or send in the background.

**Background limitation:** this version deliberately uses foreground URLSession,
not background transfer sessions, BGTaskScheduler or push. iOS may suspend or kill
the extension/app and there is no promise of eventual delivery while both are closed.
Open the main app and retry; an interrupted active lease can require up to 90 seconds
to expire. Apple requires additional background-session identifiers/shared-container
setup and containing-app completion handling for persistent background transfers;
none is pretended here.

## Tasks, reader, drafts and attachments

While active, the main app refreshes `/api/state` every five seconds and supports
pull-to-refresh. It shows actual task states/events rather than invented percentage
progress. Retry is available for failed/waiting-action tasks; cancel/approve/revoke
use the existing POST endpoints. A displayed last-refresh time identifies stale data.

Draft review fetches `/api/tasks/<UUID>/draft`, verifies the response's SHA-256 against
the task's draft ID, then validates individual base64 file lengths and hashes. Text
is shown as selectable inert text, images with the native image renderer, PDFs in
PDFKit. Approval requires a loaded draft, a matching current draft ID and a fresh
task check. The backend has no conditional `expectedDraftId` approval parameter;
there is still a server-side race between that final check and approval. This client
does not change that contract.

The WKWebView obtains its session via **native `POST /api/library-session`** with a
bearer header. Native code checks `library_session` is host-only, Secure, HttpOnly,
SameSite=Strict and path `/library/`, then installs it into a **nonpersistent**
`WKHTTPCookieStore` before the first `/library/` navigation. The bearer is never
injected into a web request, DOM, JS variable, JS message, local/session storage or
URL. The current backend sets this cookie's value to the owner-device token itself;
the client cannot turn it into a less-privileged server session without backend work.

Navigation policy and a WebKit content-rule list restrict remote resources to the
configured origin's `/library/`. Other hosts, ports, HTTP, API routes, new external
windows and external downloads are blocked. Same-origin `target=_blank` links open
in the current view using a fresh request without copied headers. Same-origin PDFs
WebKit can display may load inline. TLS trust is not overridden. Local data/blob
resources are allowed only as document resources, not external navigation.

The existing bootstrap's management functions require a JavaScript token. This
client instead locks `window.LIBRARY_DELETE` to `undefined` at document start and
removes `#open-trash`/`#trash-dialog` after creation with a document-end observer.
No backend/public file is changed and no token is supplied to make those controls
work. The document remains a read-only reader. Closing the reader or logging out
destroys its view and clears its ephemeral website data/cookies.

**附件** opens a native list of current archives, separate from draft review.
`GET /api/archives/<SHA-256>` retrieves the selected archive with a native same-origin
header. The entire bundle digest and each attachment's digest/size are verified.
Every uploaded PDF/image/Markdown/text/subtitle file is listed and can be opened in
the native viewer. No filename becomes a filesystem path, source URL, or authenticated
external request. Omitted media are explicitly listed as remaining on the worker.
This avoids making HTTP attachment disposition or WebKit download support a barrier
to reading materials. This version does not implement exporting files to Files or
offline archive caching; PDFs/images/text are held for the current native view.

## API correspondence (no backend changes)

| Feature | Existing route / contract |
| --- | --- |
| Pair | `POST /api/pair {key,name,clientType,...}` → `{device,token}`, owner required |
| Device identity / metadata | `GET /api/device-policy`, `POST /api/devices/me/info` |
| State / computer choices | `GET /api/state` → me/devices/tasks/archives |
| Save task | `POST /api/tasks {submissionId,content,type,autoArchive,tags,deviceId?,agent?}` |
| Continue / cancel | `POST /api/tasks/<UUID>/retry` or `/cancel` with `{}` |
| Draft / approval | `GET /api/tasks/<UUID>/draft`, `POST .../approve {}` |
| Revoke | `POST /api/devices/<UUID>/revoke {}` |
| Web reader session | `POST /api/library-session {}` → Set-Cookie; then GET `/library/` |
| Native archive attachments | `GET /api/archives/<64 lowercase hex digest>` |

## Validation and remaining acceptance

On Windows or macOS, Python 3 alone runs the portable suite:

```sh
python scripts/check_contract.py
```

The portable checks cover matching real extension plists/entitlements, backend
contract assumptions, credential/reader guardrails, two-process competing claims,
crash rollback, stale-lease completion and origin binding. The SQLite tests execute
SQL extracted from `Shared/Outbox.swift`; they do not execute its Swift wrapper or
iOS filesystem APIs. Run the Xcode XCTest target separately to exercise the native
reader policy, QR validation, provider capture and device presentation. Current
verification results are recorded in the migration review linked above.

Required Mac/device checks before calling this release ready:

1. Generate the project, build all targets and run XCTest with the commands above.
   Verify actual signed entitlements on both app and `.appex`, including the same
   resolved App Identifier Prefix and App Group. No unresolved `$(...)` should remain.
2. Pair with a test owner code; reject worker, expired and revoked codes. Verify
   HTTP/invalid certificates and redirects fail without credentials going elsewhere.
3. Share Safari title + selection + URL, Notes text, Unicode/emoji, repeated/multiple
   URLs, multiple items and long content from actual source apps. Compare saved
   original parts and the task's `content`; do not infer correctness from a title alone.
4. Share in airplane mode and before pairing; save, tap Done, terminate both processes,
   reopen, inspect full original/settings and bind/retry. Kill during send and retry
   after lease expiry; the server should return exactly one task for that UUID.
5. Change computer/Agent, go offline, save and verify unchanged choices on retry.
   Simultaneously open the app/extension and confirm one active claim per item.
6. Exercise real task progress, waiting-action retry, cancellation, manual draft
   review/approval, another-device revocation and self-revocation using test data.
7. Confirm native cookie is HttpOnly/Secure/path-scoped and not in JS storage or URL;
   test external/subframe/image/redirect/new-window links against a controlled test
   server. Confirm delete/trash controls are absent and same-origin reader links work.
8. Browse an archived PDF, image, source text and subtitles using **附件**, and a
   manual-review draft. Verify omitted video/audio are accurately described. Navigate
   away/logout and confirm no old reader/attachment UI remains accessible.
9. Capture real iPhone screenshots from the final candidate only after runtime
   verification; historical screenshots do not establish acceptance of the current version.

Other limits: no arbitrary binary input upload, no push/background delivery, no
offline reader cache, no native collection editor outside the system Share Extension,
no release signing assets, no server-generated device-scoped read-only role.
Large archive JSON/base64 responses may consume substantial memory within the
backend's 40 MiB decoded / 58 MiB transport limits; real-device memory checks remain.

## Official sources consulted

Reviewed 2026-09-24. Architecture and API decisions follow these Apple references;
they do not constitute runtime verification of this implementation.

- [Apple: Handling Common Scenarios](https://developer.apple.com/library/archive/documentation/General/Conceptual/ExtensibilityPG/ExtensionScenarios.html)
  — shared containers, synchronization using SQLite/locks, Safari preprocessing,
  and background URLSession/container requirements.
- [Apple: Sharing access to Keychain items](https://developer.apple.com/documentation/security/sharing-access-to-keychain-items-among-a-collection-of-apps)
  — common Keychain access groups for related signed apps/extensions.
- [Apple: NSExtensionContext.completeRequest](https://developer.apple.com/documentation/foundation/nsextensioncontext/completerequest(returningitems:completionhandler:))
  — complete the host request only once the extension's work is complete.
- [Apple: NSItemProvider](https://developer.apple.com/documentation/foundation/nsitemprovider)
  and [NSExtensionActivationRule](https://developer.apple.com/documentation/bundleresources/information-property-list/nsextension/nsextensionattributes/nsextensionactivationrule)
  — provider representations and supported system Share Sheet inputs.
- [Apple: WKHTTPCookieStore](https://developer.apple.com/documentation/webkit/wkhttpcookiestore)
  — native cookie installation into the selected website data store.
- [Apple: WKContentRuleListStore](https://developer.apple.com/documentation/webkit/wkcontentruleliststore)
  and [WKNavigationDelegate](https://developer.apple.com/documentation/webkit/wknavigationdelegate)
  — resource filtering and navigation policy.
