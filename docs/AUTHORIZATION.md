# 灵藏 · Authorization Lifecycle

The English product name remains InspiraiNest. Worker is displayed as 工作节点;
protocol names, packages, command names, update feeds and identity namespaces
are unchanged.

## Categories and permissions

Authorizations remain in the existing records store. `category` is maintained
by the service: desktop, mobile, browser, integration or unknown. Desktop,
mobile and browser authorizations appear in separate groups; read-only CLI
grants are application authorizations. Classification never grants permission.
Legacy native management records registered as web remain desktop records.
Unknown authorizations are retained rather than guessed or deleted.
The legacy `web` marker alone is not enough to classify a browser. Its existing
credential can supply browser metadata in place before cookie conversion;
classification and metadata updates never create execution credentials.

Desktop clients retain distinct management and execution tokens. Only execution
credentials with worker permission can report heartbeats, claim tasks, report
progress or publish assigned results. Management and mobile/browser credentials
cannot gain execution permission by changing metadata. Existing manual archive
imports remain available to owners.

`lastHeartbeatAt` is written only by an authenticated Worker heartbeat. Reading
or managing a desktop client does not make its Worker online. Automatic claims
require a heartbeat within 45 seconds, a usable Agent and matching capabilities.
Explicit offline targeting waits for the same authorized Worker to return.

## Browser sessions

`collector_browser_session` is a Secure, HttpOnly, SameSite=Strict cookie scoped
to `/`. Cookie-authenticated writes require the configured public origin.
Explicit Bearer credentials take precedence and never fall back to cookies.
Cookie flags and server-side invalidation follow the
[OWASP session management guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).
The seven-day sliding lifetime is this product's chosen policy.

Browser logins expire seven days after actual activity, without an absolute
maximum. Opening a page and trusted user interactions renew the session;
interactions are throttled to once per minute. Background polling, metadata
updates and Worker heartbeats do not renew it. Production requires HTTPS and a
correct `COLLECTOR_PUBLIC_URL` origin.

- `GET /api/browser-session`: current browser authorization, without renewal.
- `POST /api/browser-session/activity`: renew and issue the private cookie.
- `POST /api/browser-session/logout`: invalidate the current credential and
  clear browser and legacy reading cookies, retaining its authorization record.

Existing browser Bearer credentials are converted through the activity endpoint
without immediate reauthentication. Legacy records receive an initial seven-day
window on migration; IDs, credentials, notes and task ownership are preserved.
Browser re-login reuses its profile record and rotates its token. Browser logout
does not invalidate previously approved or issued read-only CLI grants. Explicit
authorization revocation still blocks its associated credentials.

## Verification

- `npm.cmd test` includes fake-clock expiry, renewal, migration, CSRF, execution
  isolation and offline-target recovery tests.
- `node scripts/test-browser-sessions-ui.cjs` checks private cookies, restored
  browser contexts, grouped views, dispatch filtering and mobile viewports.
- `node scripts/test-account-security-ui.cjs` covers credential rotation, TOTP,
  recovery and explicit CLI consent with the shared browser cookie.
