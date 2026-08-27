# Observability contract

Last verified: 2026-08-27 with Codex CLI 0.144.5.

## What the official interface provides

Codex App Server is the supported interface used by rich Codex clients. Its
stable account surface provides:

- `account/rateLimits/read`: one or more metered quota buckets, each with an
  official used percentage, duration, reset timestamp, and optional plan data.
- `account/rateLimits/updated`: notifications when those values change.
- `account/usage/read`: account-level lifetime token activity and optional
  daily token buckets.
- `thread/tokenUsage/updated`: thread token usage containing input, cached
  input, output, and reasoning-output token counts.

Official reference:
<https://developers.openai.com/codex/app-server/>

The agent starts `codex app-server` as an authenticated local subprocess and
uses JSON-RPC after the required `initialize` / `initialized` handshake. It
does not open or copy Codex credential storage.

## What is locally measurable

Codex session events expose enough metadata to aggregate, on the device:

- launch source/originator;
- model and reasoning effort for a turn;
- input, cached-input, cache-write, output, reasoning-output, and total tokens;
- turn start/completion time and duration;
- counts and byte lengths for tool, message, and file-change events.

Only numeric aggregates and non-content labels are uploaded. The session ID is
one-way hashed before upload. Paths remain local.

## What must be estimated

The account service does not return a per-device, per-model, per-effort, or
per-purpose quota charge. QuotaLab therefore treats the latest group-wide quota
percentage as official and apportions only positive percentage deltas across
local activity observed in the same interval.

- A single observed active device gives a higher-confidence estimate.
- Concurrent activity is apportioned by measured token activity and marked
  medium confidence.
- A delta with no matching local activity is unattributed.
- Usage present before QuotaLab's first near-reset observation is unattributed.
- A reset, changed reset timestamp, stale snapshot, or percentage correction
  starts a new attribution segment rather than producing a negative charge.

The user interface must never remove these labels or combine official and
estimated values under one unqualified number.

The selected quota window renders its official used percentage as one complete
instrument whose colored subsegments are the current per-device estimates.
Each segment is labelled as an estimated percentage of the full quota cycle,
with confidence shown beside the device. The center total remains explicitly
official, and unexplained usage remains a visible unattributed segment.

## Launch-surface coverage

QuotaLab does not wrap a launch command. The agent runs independently, so the
official account percentage includes activity from CLI, IDE, desktop, and
remote/cloud surfaces. Detailed device attribution is available when that
surface writes local Codex events on the enrolled computer. Activity visible
only to the account service stays in the unattributed segment.
