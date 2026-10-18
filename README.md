# 灵藏 · InspiraiNest

A local-first personal research library with offline browsing, a self-hosted collection service, desktop Agent Workers, mobile sharing clients and a read-only CLI.

**License: [MIT](LICENSE). Copyright (c) 2026 Wuhan Inspirai Technology Co., Ltd.** The brand is InspiraiNest, using the current application icon. See [rights and brand scope](docs/RIGHTS.md). This snapshot carries no private Git history, personal library entries, production deployment scripts or signing workflow.

Start with [self-hosting instructions](docs/SELF_HOSTING.md) and the [Worker security model](SECURITY.md). To use only the offline library, install Node.js 24+, run `node scripts/catalog.mjs build` and `node scripts/catalog.mjs check`, then double-click `index.html`.

The data format is documented in [AGENTS.md](AGENTS.md) and [templates](templates/README.md). Edit each entry's `source.json`; regenerate the catalog instead of editing generated files. Browser dependencies are bundled locally; `file://` remains supported.

General source code and third-party components have separate rights; retain [third-party notices](docs/THIRD_PARTY.md). Public CI tests synthetic fixtures and builds unsigned/ad-hoc test artifacts. It does not publish a release or connect to a production service.

The desktop Worker supports in-app Windows/macOS update checks against public GitHub Releases. Release packaging, signing and verification are described in [desktop update instructions](collector/DESKTOP_UPDATES.md).

The planned Windows WeChat share-target integration is tracked in the [implementation plan](docs/WINDOWS_WECHAT_SHARE_TARGET_PLAN.md). Implementation and Windows/WeChat acceptance are pending.

Collection extension research, WeChat extraction contracts, comment collection boundaries and the proposed development sequence are indexed in [plugin development references](docs/plugin-development/README.md). These are research inputs, not newly shipped plugins.

The [comment collection research and validation report](docs/COMMENT_COLLECTION_RESEARCH.md) records the CatBus prototype, Bilibili results, WeChat session limitations and follow-up acceptance criteria. It is a development reference; comment collection is not integrated into InspiraiNest.

The [five-platform commerce data feasibility report](docs/research/ecommerce-public-data-feasibility.md) records candidate tools, supplied-link probes, Catbus validation and a proposed store-monitoring workflow. Store-wide enumeration and several metrics remain unverified; the report is a research deliverable.

The iOS App Store build and submission checklist is in [iOS release instructions](docs/IOS_APP_STORE_RELEASE.md).
