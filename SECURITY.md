# Security model

The collector is a single-owner, self-hosted system. Do not offer its Worker queue to untrusted tenants. A paired owner can submit arbitrary task text that will reach an Agent running on a computer. The task directory and prompt rules are **not** an operating-system security boundary.

| Boundary | Current control | Residual risk / operator responsibility |
| --- | --- | --- |
| Browser/client → service | Device roles, single-use pairing, revocation, read-only scopes; HTTPS outside loopback | A stolen owner token can queue malicious work and read private archives. Protect the service, browser profile and backups. |
| Service → Worker | Authenticated assignment; device ownership persists during disconnect | Compromised service/owner can control task content. Pair only to a server you operate and trust. |
| Source material → Agent | Fixed collection instructions label web/media content as untrusted | Prompt injection can still lead to tool misuse; a prompt is not a sandbox. |
| Agent → host | New default Codex profile explicitly requests workspace-write; no automatic permission bypass; default examples disable CodeBuddy fallback | Custom profiles, global MCP/tool configuration, CLI changes and platform sandbox behavior can expand access. Run in a dedicated low-privilege OS account/VM without unrelated files, browser sessions, SSH keys or production credentials. |
| Parent environment → child | Service, cloud, signing and pairing environment variables are filtered | Filtering is not a secret detector. CLI provider credentials and user login files remain accessible. Unknown environment variable names may still carry secrets. |
| Agent → network | Default profile does not enable sandbox network; capture profile explicitly opts into broader capabilities | Enforce egress/network restrictions at the OS/container boundary when required. Source access may expose IP addresses and data to third parties. |
| Local results → service | Registered-file allowlist, role/type/size checks, path containment, checksums; raw media and credential filenames excluded | Allowed Markdown/text/images may themselves contain private information. Use review-before-archive and inspect results; no semantic DLP or OCR is claimed. |
| Logs and cancellation | Local bounded logs, token redaction in desktop view, drain/pause controls | Agent output can contain other secrets. Protect logs and retention. Revocation does not kill an offline process or retract downloaded copies. |
| Contributors → CI | Public CI has read-only token, no signing secrets, no production commands; separate manual signed release workflow | Branch/environment protections must be configured by the repository owner. Public repository must have no production credentials. |

No supported automatic upload of browser cookies, platform login files, signing keys or whole home directories exists. `watchLibrary` is off by default and must be explicitly configured. Do not use Agent flags that bypass approvals/sandbox restrictions merely to overcome collection failures. Existing custom profiles are not silently rewritten.

Report security issues through [GitHub private vulnerability reporting](https://github.com/inspirai-store/InspiraiNest/security/advisories/new). Do not paste tokens, private source material, logs or exploit-bearing attachments into public issues. No response-time promise is currently configured.

Supported release policy and actual sandbox validation on each supported OS remain release decisions. Local fixture tests verify process/API contracts; they do not prove containment of a real Agent on every host.
