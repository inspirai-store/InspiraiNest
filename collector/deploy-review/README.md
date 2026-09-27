# App Review demo collector

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
`COLLECTOR_MASTER_KEY` key. The secret and data volume belong only to this demo.
