# Third-party inventory

This inventory records evidence, not a blanket redistribution clearance.

| Component | Evidence | Release obligation / open item |
| --- | --- | --- |
| marked, DOMPurify, Lucide browser distributions | `assets/vendor/README.md`, adjacent original `*.LICENSE`; mobile copies use the same libraries | Keep original notices in source and client bundles. DOMPurify offers license alternatives; preserve its original text. |
| Node service/build dependencies | `collector/package-lock.json`; generated `docs/npm-dependencies.json` | 410 locked entries have license metadata. Names, versions, integrity hashes and dev flags are recorded. Actual packaged dependency license files must still be preserved. Regenerate with `node collector/scripts/dependency-inventory.mjs`. |
| Electron / Chromium and native libraries | Electron distribution notices (`LICENSE`, `LICENSES.chromium.html`) and package dependencies | Keep the notices shipped by Electron in binary releases; an npm license field alone is insufficient. |
| Go CLI modules | `collector/cli/go.mod`, `go.sum`, `THIRD_PARTY_NOTICES.md` | CLI packaging tool collects actual module license texts into `licenses/`. Recheck final release archives. |
| AndroidX core and ZXing Android Embedded | `collector/mobile/android/app/build.gradle`, resolved `debugRuntimeClasspath`, `docs/android-dependencies.json` | 22 runtime artifacts have Apache 2.0 metadata, including the upstream parent POMs for Guava listenablefuture and ZXing core. Collect actual license/NOTICE texts for the release graph before binary distribution. Android SDK/build tools are prerequisites, not redistributed here. |
| Gradle wrapper | Wrapper JAR, pinned distribution URL and `gradle/wrapper/LICENSE` | Retain the upstream Apache 2.0 notice with the wrapper. |
| iOS SDK frameworks | `collector/mobile/ios/project.yml` | Requires the builder's Apple toolchain/account; no Apple SDK binaries are exported. |
| Product and UI artwork | `collector/brand/`, derived client PNG/ICO files | Owner confirmed the existing app icon for InspiraiNest; bytes remain unchanged. Artwork is separate from the MIT code license; see RIGHTS.md. |

There are no personal collection entries in the public export allowlist. No conclusion about licenses of archived source material is implied.
