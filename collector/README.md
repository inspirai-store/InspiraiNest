# Collector

See [installation and configuration](../docs/SELF_HOSTING.md), [security boundaries](../SECURITY.md), [rights decisions](../docs/RIGHTS.md) and [third-party notices](../docs/THIRD_PARTY.md).

With Node.js 24+, run `npm ci --ignore-scripts`, `npm test`, then `npm start` here. The service listens on loopback and initializes local storage; it does not connect to any preconfigured production infrastructure. Worker execution is separate and requires explicit pairing and local Agent configuration.

macOS Worker: click the menu-bar icon to toggle its status panel. Closing the manager hides the Dock icon while the Worker stays available; quit waits for active work and synchronization to finish.
