# macOS menu-bar Worker

The Worker uses a template menu-bar icon and a status panel. Clicking toggles the panel; outside clicks and Escape close it. The manager uses native minimization and Dock restoration. Application quit waits for active Worker tasks and synchronization.

Validation commands:

```sh
cd collector
npm test
node scripts/test-desktop.cjs
```

The desktop test uses isolated localhost synthetic tasks. Native menu events injected by this test do not establish physical mouse-click behavior; actual local UI checks and signing/notarization are recorded per release.
