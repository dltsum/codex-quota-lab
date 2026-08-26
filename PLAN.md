# QuotaLab implementation plan

Status: completed

Project: QuotaLab for Codex

Repository: [dltsum/codex-quota-lab](https://github.com/dltsum/codex-quota-lab)

## Objective

Build a small self-hosted tool for one Codex account used from several
computers. A shared group key admits browsers and devices to the same group.
Each device can register a human-readable ID; an unnamed device is identified
inside the group by its observed IP and MAC address. Group members can inspect
the current Codex quota windows, device activity, model and reasoning-effort
mix, active time, and coarse token-purpose mix.

## Frozen measurement contract

1. The group-wide `usedPercent`, window duration, and reset time come only from
   Codex App Server `account/rateLimits/read` and are labelled **official**.
2. Token counts, model, reasoning effort, surface, activity duration, tool-call
   counts, and file-change counts come from local Codex event logs and are
   labelled **local measurement**.
3. Per-device, per-model, per-effort, and per-purpose shares of quota percentage
   are not returned by OpenAI. They are apportioned from official percentage
   deltas using local token activity and are labelled **estimated attribution**.
4. Activity that cannot be tied to an enrolled device is retained as an
   **unattributed** segment. Concurrent-device attribution lowers confidence;
   it is never silently presented as exact.
5. No prompt, response, reasoning text, command, tool argument, path, repository
   content, OAuth token, API key, or Codex login artifact may leave a device.

This contract is the test and UI wording baseline unless the user explicitly
changes it.

## Scope

- Central TypeScript service with an embedded SQLite database.
- Independent cross-platform device agent that works while Codex is launched
  through CLI, IDE extension, or the ChatGPT/Codex desktop app.
- Shared-key group creation/login, opaque browser sessions, per-device tokens,
  key hashing, rate limiting, idempotent ingestion, and safe CSV export.
- Responsive Chinese-first dashboard with quota horizon, time series, device,
  model, effort, purpose, and launch-surface charts; device detail drill-down.
- Soft per-device budgets and threshold warnings. This is observation and
  coordination, not a hard blocker for Codex launches.
- Node/pnpm local deployment, Docker deployment files, agent setup guide, CI,
  tests, and a private GitHub repository by default.

## Acceptance checklist

- [x] Creating a group and joining it with the same key works.
- [x] A wrong key and revoked/invalid device token fail closed.
- [x] Named and unnamed device labels follow the privacy contract.
- [x] Agent obtains official quota data through App Server without reading
      Codex credential files.
- [x] Incremental scanner handles appended, locked, truncated, and malformed
      JSONL without uploading content or double-counting events.
- [x] CLI, IDE, desktop, cloud, subagent, and unknown source mappings are tested.
- [x] Official quota values remain distinct from estimates end to end.
- [x] All requested global and per-device visual breakdowns render.
- [x] Missing/unattributed data and confidence are visible.
- [x] CSV export contains aggregates only.
- [x] Lint, typecheck, unit, integration, production build, and browser E2E pass.
- [x] Clean commit is pushed to GitHub without secrets or generated databases.

## Milestones

1. Capability and privacy contract — completed 2026-08-27.
2. Repository and shared contracts — completed 2026-08-27.
3. Server, database, authentication, and attribution engine — completed 2026-08-27.
4. Device agent and Codex collectors — completed 2026-08-27.
5. Dashboard and drill-down experience — completed 2026-08-27.
6. Verification, security review, documentation, commit, and GitHub delivery — completed 2026-08-27.
