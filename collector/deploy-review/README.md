# App Review collector

This is a separate, temporary collector for Apple App Review. It has its own
SQLite volume and master pairing key. Never import personal library records or
mount production secrets. The review instance accepts requests until
`COLLECTOR_REVIEW_EXPIRES_AT`; refresh the date and pairing details for a later
review, then remove the Deployment, Ingress, Service, PVC, and Secret after the
review is complete. Keep the pairing key out of Git.

The public address is `https://review-library.inspirai.store`. The current
expiry is 2026-11-12 16:00 China Standard Time. The installed iOS app can pair
with the server address and the temporary master key through **设备 → 使用地址与配对码连接**.

Run `kubectl --context aliyun -n inspirai apply -f collector/deploy-review/review.yaml`
after creating `library-review-key` with a separate random value under the
`COLLECTOR_MASTER_KEY` key. The secret and data volume belong only to this instance.

The `basic-worker` sidecar completes text and link shares in this isolated
environment. It saves exactly the text and URL received from the iOS share
extension. It does not fetch a linked webpage or run AI processing; link-only
archives are marked partial. Its worker credential is stored in the review PVC.

The three checked-in, self-authored articles/notes in `library/` are non-private
review content. To publish an updated set, run this from the repository root:

```sh
set -o pipefail
kubectl --context aliyun -n inspirai get secret library-review-key \
  -o 'jsonpath={.data.COLLECTOR_MASTER_KEY}' \
  | node collector/deploy-review/publish-library.mjs --publish
```

The publisher checks that it is replacing only the expected isolated set,
preserves earlier snapshots, and revokes its temporary maintenance device.
