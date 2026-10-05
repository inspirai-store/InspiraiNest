# macOS menu-bar Worker

The Worker uses a template menu-bar icon and a status panel. Clicking toggles the panel; outside clicks and Escape close it. The manager uses native minimization and Dock restoration. Application quit waits for active Worker tasks and synchronization.

Validation commands:

```sh
cd collector
npm test
node scripts/test-desktop.cjs
```

The desktop test uses isolated localhost synthetic tasks. Native menu events injected by this test do not establish physical mouse-click behavior; actual local UI checks and signing/notarization are recorded per release.

The `inspirainest-macos` self-hosted session currently cannot minimize even a bare Electron window. Its release job sets `COLLECTOR_DESKTOP_SKIP_NATIVE_MINIMIZE=1`; the result explicitly records that one check as skipped. Local runs check minimization by default. Native minimization still requires manual acceptance on a functioning macOS session; all other lifecycle and safe task-drain assertions remain required.
