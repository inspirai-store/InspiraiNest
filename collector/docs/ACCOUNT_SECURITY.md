# Account Security

Open `/security` after owner login. The existing service is single-owner: the
login credential replaces the initial management key, not a username/password
account system. New credentials must contain 8-200 characters. The settings page
shows status and actions; credential changes and MFA operations use modal dialogs.
An authenticated owner does not re-enter the current login credential.

## Authenticator Binding

- Supports RFC 6238 TOTP: SHA-1, six digits, 30 seconds, one-step clock tolerance.
- Open the binding dialog, scan the QR code (or enter the manual
  secret), and confirm a dynamic code. Pending setup expires after ten minutes
  and is bound to the authenticated device. MFA is not active before confirmation.
- Both `/login` and `/authorize` start with the credential alone. After binding,
  an unfamiliar browser submits the correct credential before a modal asks for
  a dynamic code or recovery code. A confirmed browser can omit that login factor.
  CLI consent remains an explicit action.
- Each accepted TOTP time step can be used only once across all service replicas.
  For another operation within the same interval, wait for the next code.
- Ten cryptographically random, single-use recovery codes are displayed once.
  Store the downloaded file securely, separately from the login credential.
  Only SHA-256 hashes are retained. Regenerating codes invalidates all old ones.
- Credential changes, MFA removal and recovery-code rotation require an active
  owner authorization and, if enabled, an existing second factor (or recovery
  code). They do not ask for or validate `currentKey`. When MFA is disabled,
  possession of an authorized owner session permits these changes.
- Already-authorized devices and unfinished tasks retain their credentials and
  IDs. Device revocation remains available separately. An authorized owner can
  issue one-time pairing codes; these delegated authorizations do not require
  entering the owner's TOTP again. Older native clients without TOTP fields
  must use such a pairing code, not the owner credential.

## Persistence and Operations

### Confirmed Browsers

The host-only `__Host-collector_browser_trust` cookie is Secure, HttpOnly and
SameSite=Strict. SQLite/MySQL stores only a hash of its random proof in separate
`browser-trust` records, bound to the browser authorization and profile. The
proof cannot log in by itself, and claimed device metadata cannot substitute for
it. It expires after 30 inactive days, separately from the seven-day login session.
Successful login, page opening and explicit session activity renew confirmation;
state polling, metadata synchronization and background refresh do not.

Logout invalidates the login but retains confirmation. The security page shows
confirmation status and offers "forget this browser", which leaves the current
login intact. Revoking the browser invalidates its proof. Credential changes and
TOTP binding/removal advance a database-persisted trust epoch, invalidating all
old proofs without invalidating sessions, native credentials or tasks. Remembered
confirmation never replaces MFA for security operations.

Pre-feature, still-valid browser logins can migrate once without another factor
after their authorized session and matching browser profile are checked. The
device migration marker survives logout/re-login and forget. Newly paired
browsers, revoked/expired sessions and historical records cannot use this path.
After a security-setting invalidation, old sessions cannot bootstrap fresh trust.
Browser profiles cleared from site data and private browsing contexts need normal
login verification. Credentials and factors are not saved to Web storage.

`setting/account-security-v1` in SQLite or MySQL is authoritative. It stores a
salted scrypt credential verifier (`N=32768,r=8,p=3`), encrypted TOTP seeds,
recovery-code hashes, the last consumed OTP counter and shared failure limits.
The original `COLLECTOR_MASTER_KEY` / `admin-key.txt` is a bootstrap credential
only when no security record exists. Changing that environment variable does
not override an existing changed credential or disable MFA.

AES-256-GCM encryption uses the stable `COLLECTOR_AUTH_ENCRYPTION_KEY` (at least
32 characters), or the original stable master key if the variable is unset.
Do not rotate this encryption material without explicitly migrating encrypted
seeds, even after changing the login credential through the UI. Back up the
database and this encryption material together; do not publish either. Restoring
only the database with different encryption material makes bound seeds unreadable
and fails closed. No secret is included in `/api/state` or security-status output.

Once MFA or a changed credential is in use, never roll back to a service version
that ignores the security record: it would accept the old bootstrap key without
MFA. Any rollback must retain the compatible account-security authentication
module, routes and stable encryption material.

Credential/factor verification failures are limited to ten per minute in the
shared database, in addition to the existing per-process pairing limit. Locking
the security row atomically consumes recovery codes and TOTP counters; failures
are committed before returning an error so retries cannot reset the limit.
Use HTTPS except on loopback. Explicit Bearer credentials retain precedence;
cookie-authenticated mutations require the same origin. The existing no-store,
no-referrer, self-only CSP are retained. This feature does not
add email, SMS, push notifications, passkeys, or an unauthenticated reset endpoint.
Loss of both credential and recovery methods requires deliberate operator
recovery, not a bootstrap-key bypass. MFA does not protect a device token that
has already been stolen: revoke that device explicitly.

## API

- `GET /api/security`: owner-only redacted status.
- `POST /api/security/credential`: `newKey`, `confirmKey`, optional
  `otp` or `recoveryCode`.
- `POST /api/security/totp/setup`: `{}`; returns a temporary secret, QR
  data URL and expiry only to the requesting authenticated owner.
- `POST /api/security/totp/confirm`: `otp`; returns recovery codes.
- `POST /api/security/totp/cancel`: cancels this device's pending setup.
- `POST /api/security/totp/disable`, `POST /api/security/recovery-codes`:
  existing `otp` or `recoveryCode`.
- `POST /api/pair` accepts `otp` or `recoveryCode` with the owner credential.
  `mfa_required`, `mfa_invalid`, `credential_invalid` are explicit error codes,
  separate from expired/revoked session errors. Worker/reader tokens cannot
  manage account security.
- `GET /api/browser-trust`: current browser-cookie session's redacted confirmation
  status (`confirmed`, `expiresAt`, `lastUsedAt`), without renewal.
- `POST /api/browser-trust/bootstrap`: same-origin, browser-cookie-only one-time
  migration with existing browser metadata. No trust proof is returned in JSON.
- `POST /api/browser-trust/forget`: same-origin, browser-cookie-only confirmation
  removal; does not log out or revoke the authorization.

## Isolated Verification

Run `npm test` for SQLite regression and
`node scripts/test-auth-mysql.cjs` against a disposable local Docker MySQL 8.4
container. The latter uses generated fixture credentials, loopback-only ports
and disposable tables, then stops its own container. Never point these tests at
the production database. Web checks include `test-browser-trust-ui.cjs`,
`test-account-security-ui.cjs` and `test-browser-sessions-ui.cjs` under `scripts/`.

References (checked 2026-10-03):
[OTPAuth](https://github.com/hectorm/otpauth),
[OWASP MFA guidance](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html).
