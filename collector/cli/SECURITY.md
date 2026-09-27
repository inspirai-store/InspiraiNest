# Credential and network boundaries

- Windows uses native Credential Manager APIs through go-keyring/wincred;
  Linux uses the Secret Service D-Bus API. Linux needs an available, unlocked
  Secret Service such as GNOME Keyring (including in headless sessions).
- macOS uses go-keyring's `/usr/bin/security` integration. In the pinned v0.2.6
  implementation, writes use `security -i` and send the encoded credential on
  stdin, **not in process arguments**. Reads/deletes use service/account arguments.
  This is a system-command dependency, not direct native Keychain API access;
  access is subject to Keychain ACLs and possible prompts. Verified from the
  pinned [upstream implementation](https://github.com/zalando/go-keyring/blob/v0.2.6/keyring_darwin.go).
- No plaintext files, token flags, token environment variables, or fallback
  credential stores. A unavailable/locked store fails with exit 8. If storing
  a newly issued token fails, the CLI attempts to revoke it before returning.
- Secure-store access belongs to the OS execution identity and store session.
  Sandboxed agents using another account cannot inherit a parent account's
  credential simply by sharing an executable. Login inside the agent's execution
  context and approve its device code in the browser; subsequent commands use
  that same context. No privilege changes or cross-account credential copying
  are required or implemented.
- The product is InspiraiNest. The credential service remains `LingNest CLI` for upgrade compatibility; account is the canonical origin. The record
  also includes the origin and expiry, checked before use. HTTPS/default port
  normalization cannot bridge schemes or non-default ports. Server override is
  per invocation or the explicit LINGNEST_SERVER environment setting; no hidden remembered server.
- Standard Go TLS certificate verification remains enabled. There is no insecure
  TLS option. Only loopback HTTP is permitted. All HTTP redirects are rejected,
  so a redirect never forwards credentials or changes a form POST into GET.
- API error text is not echoed verbatim because servers can echo credentials;
  known machine codes and HTTP status are returned. Tokens/device codes are
  never printed. User codes and verification URLs are intentionally shown.
- Verification and reader URLs must resolve to the configured origin. The
  application never transfers CLI bearer credentials into a browser session.
- Downloads verify trusted entry metadata, header digest, actual digest and
  byte count before exclusive output creation, with a 16 MiB cap. SHA256 checks
  integrity relative to the authenticated server; they are not publisher signatures.
- There are no collection, upload, edit, delete-entry, admin or write-scope
  commands. The only POSTs are device authorization, token polling and logout.

OS administrators and processes running as the same user remain in the OS
credential-store trust boundary. macOS Keychain prompts and Linux desktop/
headless service availability require native platform validation.
