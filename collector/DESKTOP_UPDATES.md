# Desktop client updates

macOS clients use the generic update feed at `https://library.inspirai.store/updates/macos`. Windows clients retain their configured update channel. Updates download only after the user chooses 下载更新 and install after 安装并重启; an active Worker drains before the app is replaced.

Regular public CI builds test artifacts without signing or publication credentials. Formal macOS releases use `.github/workflows/collector-release.yml`, manually dispatched from the reviewed `main` commit. The `signed-release` environment, the `ENABLE_SIGNED_RELEASE=true` repository variable and the dedicated `inspirainest-macos` self-hosted runner are required. Pull requests cannot use this release job.

Repository Secrets retain the existing names: `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `OSS_RELEASE_REGION`, `OSS_RELEASE_BUCKET`, `OSS_RELEASE_ACCESS_KEY_ID`, and `OSS_RELEASE_ACCESS_KEY_SECRET`. Never export plaintext values into logs or repository files.

`npm run build:worker:mac:release` builds Developer ID signed and notarized arm64/x64 ZIPs and DMGs, both architectures in `latest-mac.yml`, and blockmaps. The release job checks signatures, notarization, Gatekeeper, architectures, ZIP/DMG integrity and SHA-512 update metadata, then runs packaged update and lifecycle checks. It uploads the verified files to private OSS under an immutable version/run prefix and reads every object back. No GitHub Release or build artifact storage is used by this formal release job.

After the OSS completion receipt exists, stage the matching packages and metadata into the production download service. Preserve other platforms, update `worker-release.json`, and keep `latest-mac.yml` paired with its exact ZIPs. Verify public download hashes and the Mac update feed before announcing publication. A development or ad-hoc package is not a formal update release.
