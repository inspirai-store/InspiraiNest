# Public CI

Regular public CI runs service tests, Go CLI tests, Android debug checks, desktop test packaging and a local container build. Permissions are read-only and checkout credentials are not persisted. These jobs have no production or signing credentials.

CI artifacts are development builds. macOS artifacts use ad-hoc signatures and are not notarized installers. Windows CI builds have no publisher signature. Distribution, signing identities, protected branches/environments and release channels must be established separately by the project owner.

Desktop development builds include the update UI. The Windows job builds an NSIS installer and runs a packaged update-download test; the macOS job checks architecture packages and update metadata. The separate manual macOS release workflow signs, notarizes and uploads verified packages to OSS from reviewed main commits; see [DESKTOP_UPDATES.md](DESKTOP_UPDATES.md).
