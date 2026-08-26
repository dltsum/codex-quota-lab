# QuotaLab engineering rules

Read `PLAN.md`, `docs/ARCHITECTURE.md`, `docs/OBSERVABILITY_CONTRACT.md`,
`docs/PRIVACY.md`, and `WORK_LOG.md` before changing implementation code.

- Never read, copy, persist, log, or upload Codex credentials, prompts, replies,
  file paths, commands, tool arguments, or repository contents.
- Keep official account quota observations separate from locally measured token
  activity and estimated quota attribution in code, APIs, tests, and UI copy.
- A missing or stale observation is unknown; never silently synthesize it.
- Keep the collector launch-surface independent. It observes Codex state and
  session metadata; it does not wrap or patch the CLI, IDE extension, or app.
- Make schema changes additive through migrations and keep ingestion idempotent.
- Update the relevant docs and append a work-log entry after a verified change.
- Before committing: run lint, typecheck, unit/integration tests, production
  build, and the focused end-to-end test.
