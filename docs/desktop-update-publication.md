# Desktop update publication

Use the unified formal workflow below for publication. `collector/scripts/stage-desktop-channels.mjs` remains a manual staging utility; staging alone does not publish a release. Stable and Beta manifests are generated from this record by the API. The current production runtime is compatible with the installed creation and collection modules; preserve those changes when preparing packages.

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

## Optional Windows signing and device acceptance

The unsigned CI path is the current default. Only if Windows signing is enabled separately, the manual `Package reviewed desktop channel increment` workflow with `platforms: windows` uses the same checksum-pinned compatibility source as the Mac package. Configure the existing `signed-release` environment with `WIN_CSC_LINK` and `WIN_CSC_KEY_PASSWORD` secrets and the exact certificate common name in `WINDOWS_PUBLISHER_NAME`. This path requires a genuine Windows code-signing identity; do not substitute a self-signed test certificate. A hardware or cloud signing identity needs its provider configuration rather than exporting a protected private key.

The build requires code signing, signs the bundled Go CLI explicitly, and verifies Authenticode trust, exact publisher and timestamp on the app, CLI and NSIS installer. The generated update configuration must retain the official Windows URL and expected publisher. The receipt verifies the manifest's SHA-512 against the final signed installer and requires a blockmap. The workflow uploads verified artifacts only; it does not publish feeds or install on a user device. Its negative gate runs without signing credentials and rejects genuinely unsigned PE files and a trusted binary with the wrong publisher.

Before physical acceptance, record the existing installation version, publisher, application identity and actual user-data path. Save writing and wait for active tasks, normally quit, and back up the app plus `LibraryWorker` data and settings with a protected-file hash inventory. Verify the signed download and receipt before installation. On the selected Windows device, exercise a real updater download and installation, compare the complete installer hash and Authenticode publisher, then reopen old documents, collection results, diagnostics and configuration. Record real network transfer mode separately from blockmap presence. Verify quiet checking and downloading while typing, then compare the protected inventory allowing only documented runtime journals and user-initiated edits. Never treat a hosted Windows runner as physical-device acceptance.

## Unified formal release (Windows unsigned, macOS signed)

Use **Publish InspiraiNest desktop release** (`collector-release.yml`) on `main` after **Collector builds** succeeds for that exact commit. Increase the stable version in the existing package manifests and add Chinese release notes in `apps/desktop/release-notes.json` before running normal CI. Do not rebuild an already published version with different bytes.

The defaults publish both platforms:

```sh
gh workflow run collector-release.yml --ref main \
  -f include_macos=true -f publish_macos=true \
  -f include_windows_ci=true -f include_android=false
```

Leave Windows source inputs blank to select the successful main-branch CI run for the exact release commit. Explicit inputs remain available for a verified run. Windows stays on the **unsigned** ordinary CI path; no Windows signing secret is requested. macOS keeps the existing Developer ID identity, notarization and native package/update QA. The two platforms must have the same source commit and version for a combined release.

After both platform jobs succeed, `desktop-publish.yml` runs on the existing trusted Mac release runner. Only this finalizer receives `contents: write`; normal public/PR CI stays read-only and cannot access the release environment or deployment credentials. The reusable finalizer rejects non-manual and non-main events. Its concurrency group serializes production publication.

The finalizer verifies source-run/job identity, package/feed versions, SHA-256/SHA-512, every blockmap and macOS signing team. It prepares a draft Release, uploads immutable platform assets and checksums, builds an overlay from the **currently deployed immutable API image**, verifies its real download handler in isolation, checks disk space, and pre-pulls before changing production. No running source tree, user files, database schema or credential identity is replaced. Active collection/creation runs defer publication without stopping a Worker. The original deployment strategy is restored after a readiness-gated rollout. Protected content and device authorization fingerprints must match.

One `desktop-release.json` record drives the download page, `/client-release.json`, and stable/Beta feeds for both platforms. The public full packages, hashes, ranges and blockmaps must pass readback before a new GitHub Release becomes public/Latest. Other platform metadata and registered historical files remain. A published filename/hash cannot be overwritten, a channel cannot go backwards, and reruns with unchanged bytes converge on the same release. A failure keeps the job red and any new GitHub Release in draft; retry the same source and bytes after resolving the reported cause. Failed production rollout/preservation checks restore the previous distribution image without restoring or overwriting user data.

The release runner uses its existing `aliyun` Kubernetes context, the existing `faxiang` deployment profile and ACR instance. Registry credentials are short-lived and written only to a task-private Docker directory, then removed; the runner's normal Docker login remains untouched. Keep the trusted runner online and its deployment authorization usable. Private preservation/deployment backups stay under the runner's protected temporary work directory; only bounded public verification receipts are uploaded as Actions artifacts. No kubeconfig, cloud credential, user text or full log is copied to GitHub.

### Audit and repair

**Synchronize desktop release and public downloads** (`desktop-publish.yml`) can also be manually run on `main`:

- `mode: audit`: read official current package bytes and compare GitHub assets, complete hashes, download index and update feeds. No deployment or Release mutation.
- `mode: reconcile`: add missing GitHub assets from the exact already-published official packages, verifying macOS signatures again. This does not rebuild packages, move the version, change published asset bytes, restart the service or touch user data. Both platforms must already match the repository version.

A formal build without publication remains available by setting `include_windows_ci=false` and `publish_macos=false`; macOS local-install artifacts are retained. **Archive verified macOS client artifact (OSS only)** and the reviewed compatibility channel packager are archival/recovery tools, not formal publication entry points. Ordinary `push` CI never makes a release public.

Windows real-device installation/upgrade acceptance remains separate and user-managed. Hosted Windows CI success, valid blockmaps and successful publication do not count as a physical-device update test. The optional older Windows signing workflow is not part of this unsigned default path.
