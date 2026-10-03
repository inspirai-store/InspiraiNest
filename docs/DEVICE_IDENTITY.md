# Device Identity v2

Identity describes a device; it never grants access. Pairing still requires a
one-time code or the administrator key. Authorization IDs, tokens, permissions
and task ownership are independent of the identity digest.

## Scoped Identifiers

The service persists a random namespace in the `device-identity-v2` setting.
Back up this setting with the database. Deployments, domain changes and master
key rotation must not replace it.

Clients calculate SHA-256 over UTF-8
`namespace + "\n" + source + "\n" + identifier`. Only the digest and source are
uploaded. Hostnames, IP addresses, OS versions and software versions are not
identity inputs. The namespace is public and is an isolation boundary, not a
secret or a hardware attestation mechanism.

| Client | Identifier | Boundary |
| --- | --- | --- |
| Windows | Valid SMBIOS UUID | Mainboard/VM identity changes require confirmation; cloned or placeholder UUIDs cannot prove physical uniqueness |
| macOS | Valid IOPlatformUUID | Hardware/VM identity changes require confirmation |
| Android | ANDROID_ID | Scoped to signing key, system user and device; reset/signing/user changes can change it |
| iOS | Local Keychain UUID, ThisDeviceOnly | Not a hardware serial; Keychain reset, access-group changes or device replacement can change it |
| Web / consent browser | Existing origin-local profile UUID | Clearing site data or changing browser profile requires new pairing; no Canvas/font fingerprinting |

Missing or invalid hardware identifiers use a persisted local UUID. Temporary
probe failures retain the saved identity. A local fallback is not silently
replaced when a later probe succeeds. Explicit pairing permits confirming a new
identity. Raw hardware identifiers are neither stored in the cache nor uploaded.

## Migration and Presentation

Authenticated information updates and Worker heartbeats can attach v2 metadata
to existing authorizations without changing their IDs or credentials. Old
clients remain valid. A conflicting identity returns HTTP 409; records are not
merged or revoked based on a matching hash. Existing unfinished tasks also
prevent replacing their authorization through re-pairing.

Titles use OS product names and client type. Custom names remain notes. Unknown
browser OS versions stay unknown; Windows version detection uses high-entropy
Client Hints rather than guessing from a Windows NT user-agent string.

The public home and `/login` serve the Web login and management page. `/download`
remains the client download page. `/authorize` shares the same browser identity
and rolling seven-day HttpOnly cookie session, validates an existing login, and still requires explicit
`library:read` consent. Signing out there preserves the entered confirmation
code for the next login. Authenticated reading resources and APIs remain available
to installed clients.

Authorization categories and browser lifetime are independent of identity.
See [authorization lifecycle](AUTHORIZATION.md). Worker liveness comes only
from its execution-token heartbeat, not desktop management activity.

## Verification

- `npm test` in `collector`: cache stability, fallback, hardware change,
  namespace persistence, authenticated migration, conflict, revocation and routing.
- `node scripts/test-device-identity-ui.cjs`: browser consent, stable profile,
  read-only token boundaries and 320/375px layouts.
- Android `:app:testDebugUnitTest :app:assembleDebug :app:lintDebug`.
- iOS Xcode simulator tests with an isolated DerivedData directory.

References checked 2026-10-03:
[Windows SMBIOS UUID](https://learn.microsoft.com/en-us/windows/win32/cimwin32prov/win32-computersystemproduct),
[Windows Client Hints](https://learn.microsoft.com/en-us/microsoft-edge/web-platform/how-to-detect-win11),
[ANDROID_ID](https://developer.android.com/reference/android/provider/Settings.Secure#ANDROID_ID).
