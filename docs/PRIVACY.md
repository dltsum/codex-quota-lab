# Privacy and security model

QuotaLab is designed for a trusted small group that shares one explicit group
key. It is not a replacement for ChatGPT workspace administration.

## Data that never leaves a device

- Codex OAuth tokens, API keys, login artifacts, and account email
- prompts, assistant replies, reasoning text, and conversation titles
- commands, command output, tool arguments/results, patches, and file content
- local paths, repository names, and Git metadata

The collector parses these event envelopes locally only far enough to count
tokens, event kinds, character/byte lengths, and durations. It never includes
the source text in an ingestion payload or diagnostic log.

## Data stored by the central service

- group name/slug and a scrypt hash of the shared group key
- opaque, hashed browser and device tokens
- device UUID, optional user-assigned name, platform, agent version, last-seen
  time, IP address, and (only while unnamed) MAC address
- official quota snapshots and account-level numeric usage summaries
- numeric local aggregates by model, effort, surface, and coarse purpose

When a device receives a human-readable name, the server clears its stored MAC
address. Group members can see device network identifiers because this is an
explicit product requirement. Use a long unique group key and HTTPS whenever
the server is reachable beyond localhost.

## Authentication

- Group keys are never stored in plaintext and are never returned by the API.
- Browser sessions and device tokens are random 256-bit values; only SHA-256
  hashes are stored.
- Login/enrollment routes are rate-limited and comparisons are constant-time.
- Agent ingestion is idempotent and body size is bounded.
- Production startup fails if HTTPS proxy handling or secure cookie behavior is
  explicitly misconfigured; local HTTP is allowed only for loopback testing.

## Threat boundary

Anyone who knows the shared group key can view group aggregates and enroll a
device. Rotate the key if it is disclosed. QuotaLab offers coordination and
soft budgets; it cannot revoke the underlying Codex account or enforce a hard
limit across every OpenAI client.
