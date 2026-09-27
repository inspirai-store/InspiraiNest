# Public CI

Public CI runs service tests, Go CLI tests, Android debug checks, desktop test packaging and a local container build. Permissions are read-only and checkout credentials are not persisted. No production secrets, signing environment or release publishing workflow is included in this source snapshot.

CI artifacts are development builds. macOS artifacts use ad-hoc signatures and are not notarized installers. Windows CI builds have no publisher signature. Distribution, signing identities, protected branches/environments and release channels must be established separately by the project owner.

Desktop development builds now include the update UI and GitHub Releases feed metadata. The Windows job builds an NSIS installer and runs a packaged update-download test; the macOS job checks architecture packages and update metadata. Production signing and publication remain separate; see [DESKTOP_UPDATES.md](DESKTOP_UPDATES.md).
