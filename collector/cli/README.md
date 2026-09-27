# InspiraiNest read-only CLI

Build with Go 1.23+ using `go build -o lingnest .`; on Windows use `lingnest.exe`. Run `go test ./...` first. Packaged binaries do not require Go.

Set your service on every invocation with `--server https://library.example.com`, or set `LINGNEST_SERVER`. An explicit flag overrides the environment. The default is `http://127.0.0.1:4317`; HTTPS is required outside loopback.

```sh
lingnest --server https://library.example.com auth login
lingnest --server https://library.example.com list
lingnest --server https://library.example.com search "example"
lingnest --server https://library.example.com read ENTRY_ID
lingnest --server https://library.example.com auth logout
```

Approve the displayed device code in your own service's browser session. The CLI stores credentials in the OS secure store, separately for each service origin. Linux requires an unlocked Secret Service; macOS uses Keychain; Windows uses Credential Manager. There is no plaintext fallback. `--json` returns structured results, and `--help` documents commands.

The CLI cannot submit, collect, upload, delete or edit entries. `open` opens the same service in a browser, which requires its own login. Read `SECURITY.md` and `THIRD_PARTY_NOTICES.md` beside this file. Project code is MIT licensed; copyright (c) 2026 Wuhan Inspirai Technology Co., Ltd. See LICENSE. The product brand is InspiraiNest; the lingnest command name is retained for compatibility.
