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
