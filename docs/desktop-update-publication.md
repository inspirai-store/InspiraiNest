# Desktop update publication

Use `collector/scripts/stage-desktop-channels.mjs` to create the checksummed release record after all signed packages and blockmaps are ready. Stable and Beta manifests are generated from this record by the API. The current production runtime is compatible with the installed creation and collection modules; preserve those changes when preparing packages.

## Service image size

Do not repeatedly add entire historical package directories to a production image. In the 0.2.32 release, a 12.1 GB accumulated image triggered node ephemeral-storage eviction. The deployment image was compacted to 2.57 GB while retaining all 40 files referenced by the Android, Worker, reader, macOS and desktop manifests, including blockmaps.

```sh
python3 tooling/releases/compact-service-image.py \
  --source-image YOUR_CHECKED_STAGED_IMAGE \
  --target-image YOUR_DISTINCT_COMPACT_IMAGE \
  --output-dir /absolute/path/to/new-empty-review-directory
```

The helper retains the complete runtime filesystem outside the release directory and preserves its Docker entrypoint, command, environment, user, volumes and labels. It retains every registered release file and hardlink dependency. Unregistered historical builds remain in the immutable source image; keep that source tag and digest as their archive. Do not replace it with the compact image.

Validate all referenced package bytes and original platform metadata in the compact image. Compare runtime file hashes and configuration to the staged source. Push the reviewed image and bind the deployment to its digest.

Before replacing a healthy API pod, check actual node free space against the compressed and unpacked image footprint and the kubelet eviction threshold. Pre-pull the image on a node with sufficient space using a disposable pod that only exits, without starting the API, running a Worker, mounting user data or loading credentials. Confirm successful completion before switching the service.

Keep service state, object storage and credentials unchanged. Check for active collection and creation execution before a service restart. Use the configured deployment strategy, verify health, then compare protected content and authorization hashes. Read back stable/Beta feeds, the old download aliases, HTTP ranges and a complete installer hash. A local build or an existing blockmap alone does not establish a successful update.

## Windows signing and device acceptance

The manual `Package reviewed desktop channel increment` workflow with `platforms: windows` uses the same checksum-pinned compatibility source as the Mac package. Configure the existing `signed-release` environment with `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` secrets and the exact certificate common name in `WINDOWS_PUBLISHER_NAME`. This path requires a genuine Windows code-signing identity; do not substitute a self-signed test certificate. A hardware or cloud signing identity needs its provider configuration rather than exporting a protected private key.

The build requires code signing, signs the bundled Go CLI explicitly, and verifies Authenticode trust, exact publisher and timestamp on the app, CLI and NSIS installer. The generated update configuration must retain the official Windows URL and expected publisher. The receipt verifies the manifest's SHA-512 against the final signed installer and requires a blockmap. The workflow uploads verified artifacts only; it does not publish feeds or install on a user device. Its negative gate runs without signing credentials and rejects genuinely unsigned PE files and a trusted binary with the wrong publisher.

Before physical acceptance, record the existing installation version, publisher, application identity and actual user-data path. Save writing and wait for active tasks, normally quit, and back up the app plus `LibraryWorker` data and settings with a protected-file hash inventory. Verify the signed download and receipt before installation. On the selected Windows device, exercise a real updater download and installation, compare the complete installer hash and Authenticode publisher, then reopen old documents, collection results, diagnostics and configuration. Record real network transfer mode separately from blockmap presence. Verify quiet checking and downloading while typing, then compare the protected inventory allowing only documented runtime journals and user-initiated edits. Never treat a hosted Windows runner as physical-device acceptance.
