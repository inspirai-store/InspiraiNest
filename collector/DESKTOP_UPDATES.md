# Desktop client updates

The desktop client checks the public `inspirai-store/InspiraiNest` GitHub Releases feed at startup, every six hours, and on request from the main window or tray menu. It downloads an update only after the user chooses **下载更新**, then installs it after the user chooses **安装并重启**. If the detached Worker is active, the client requests a drain and waits for that process to exit before replacing application files.

Windows updates use an NSIS installer. Existing portable builds are not self-updating; users must install an NSIS build once to enter this update channel. macOS updates require a Developer ID signed app and a ZIP for each architecture; ad-hoc CI builds are development artifacts and must not be published as update releases.

Build both platforms from the same version and commit. `npm run build:worker:win` produces `InspiraiNest-v<version>-Windows-x64.exe` and `latest.yml`; `npm run build:worker:mac:release` produces signed ZIPs/DMGs and `latest-mac.yml`. Publish the installer, both Mac ZIPs, the optional DMGs, both metadata files and the generated blockmaps as assets of the same **non-draft** GitHub Release tagged `v<version>`. Keep the generated metadata paired with its exact binaries; the SHA-512 values are verified during download. Check that the signed macOS apps retain the same Apple Team ID across releases and pass notarization/Gatekeeper validation. The public CI deliberately has no signing or publishing credentials.

Before publishing, run `npm test` and the packaged Windows update test:

```powershell
node scripts/test-packaged-update.cjs desktop/dist/win-unpacked/InspiraiNest.exe desktop/dist/InspiraiNest-v<version>-Windows-x64.exe
```

The packaged test serves a temporary local update manifest and checks that the client recognizes and downloads the real package. CI runs it on both Windows and macOS, and checks that `app-update.yml` points at this repository and macOS metadata lists both architectures. After publishing, verify `latest.yml`, `latest-mac.yml`, the file checksums and an update from an older installed version on Windows and on signed macOS builds. Do not use the unsigned/ad-hoc CI artifacts as proof of a production installation update.
