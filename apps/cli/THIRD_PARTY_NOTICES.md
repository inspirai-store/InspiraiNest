# Third-party dependencies

The package tool includes actual license texts under `licenses/` in each archive.
Versions and integrity hashes are pinned in go.mod/go.sum.

| Module | Version | Purpose |
| --- | --- | --- |
| github.com/zalando/go-keyring | v0.2.6 | OS secure credential-store adapter |
| github.com/danieljoos/wincred | v1.2.2 | Native Windows Credential Manager |
| github.com/godbus/dbus/v5 | v5.1.0 | Linux Secret Service transport |
| al.essio.dev/pkg/shellescape | v1.5.1 | macOS security stdin command escaping |
| golang.org/x/sys | v0.26.0 | Native Windows browser opening and platform APIs |

Transitive test dependencies can also appear in module metadata and license
bundles; they are not credential-store fallbacks or runtime installers.
