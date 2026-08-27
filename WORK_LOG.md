# Work log

Append-only. Times use Asia/Shanghai unless noted.

## 2026-08-27 — project admission

- Read the workspace rules and created a new isolated project rather than
  modifying an existing research repository.
- Verified locally with Codex CLI 0.144.5 that App Server initialization,
  `account/read`, `account/rateLimits/read`, and `account/usage/read` succeed.
- Verified structurally (without printing content) that local session JSONL
  contains launch source/originator, model, reasoning effort, cumulative and
  last-call token counts, task timing, tool-call events, and patch events.
- Observed local source examples for Codex VS Code, Codex Desktop, and
  non-interactive CLI execution.
- Froze the official/local/estimated/unattributed measurement boundary in
  `PLAN.md` and `docs/OBSERVABILITY_CONTRACT.md`.
- Selected a central Node service plus independent per-device agent. GitHub
  delivery defaults to private because the requested visibility was unspecified.

## 2026-08-27 — implementation checkpoints

- Implemented strict shared contracts that reject content-bearing and unknown
  ingestion fields.
- Implemented the Fastify/SQLite service: scrypt group-key authentication,
  opaque browser/device sessions, idempotent transactions, conservative quota
  attribution, aggregates, soft budgets, device drill-down, and CSV export.
- Implemented the independent device agent: App Server JSON-RPC collector,
  privacy-safe incremental JSONL scanner, durable outbox/cursors, hidden-key
  enrollment, `once`, `daemon`, `status`, and `doctor` commands.
- Verified the agent scanner across append, locked file, truncation, malformed
  line, no-duplicate, and launch-surface fixtures. A live read-only App Server
  probe returned official quota buckets and account usage without exposing
  account identity or content.
- Built the Chinese-first instrument-bench dashboard with an official quota
  horizon, persistent device rail, global and per-device breakdowns, timeline,
  data-quality indicators, soft-budget controls, responsive layouts, keyboard
  drawer dismissal, and reduced-motion handling.
- Browser E2E now passes the full create/enroll/ingest/login/chart/device-update/
  CSV/mobile flow. Visual inspection of the generated desktop and mobile
  screenshots led to stable non-animated chart rendering and a truly hidden
  closed drawer.
- Added a single-file agent packager, Windows Task Scheduler installer,
  systemd/launchd templates, Docker+Caddy deployment, and Linux/Windows CI.
- Production dependency audit initially found path-traversal advisories in the
  static-file plugin. Upgraded to the patched Fastify-compatible 10.1.3 line,
  added traversal regression coverage, and re-ran the audit to zero known
  production vulnerabilities.
- Hardened CSV cells against spreadsheet-formula injection and prevented Agent
  bearer-token requests from following redirects; both have regression tests.
- Split the dashboard into lazy-loaded React and chart chunks. The unauthenticated
  entry bundle is now about 9 KiB minified instead of loading the roughly 600 KiB
  chart stack before authentication.
- Final local gates currently pass: format/lint/typecheck, 30 unit/integration
  tests, four production builds, one full Chromium E2E scenario, a standalone
  deployed-server/dashboard smoke check, Agent single-file execution, and the
  production dependency audit. Docker runtime verification is delegated to the
  checked-in Linux CI job because Docker is unavailable on this workstation.

## 2026-08-27 - remote CI correction

- Created the private `dltsum/codex-quota-lab` repository and pushed the first
  clean commit. The initial remote run passed the container build and Chromium
  E2E jobs, while Ubuntu exposed an ordering-dependent packaging failure.
- Traced the failure to legacy production deployment changing the active
  workspace dependency state before the Agent packager ran. The deployed server
  itself had passed its health and dashboard checks.
- Isolated deployment in a minimal temporary workspace containing only the
  server, contracts, lockfile, and workspace manifests. The temporary root is
  removed after the test, so deployment pruning cannot mutate the source
  workspace.
- Re-ran the exact failed sequence locally: deployed-server smoke, single-file
  Agent packaging, and packaged CLI startup all pass with development
  dependencies still present.
- GitHub Actions run `33009779361` passed on implementation commit `e7f6061`:
  Ubuntu verification, Windows verification, Chromium E2E, and the Docker
  container build all completed successfully.

## 2026-08-27 - direct percentage allocation

- Registered the clarified requirement that concurrent-device estimates must
  appear directly inside the selected official cycle-percentage display, not
  only in a separate device chart or detail view.
- Reused the existing server `allocations` response without adding another
  state or attribution method. The focused official used ring is now composed
  of device-colored estimated percentage segments; its center remains the
  explicitly official total.
- Added an in-card allocation ruler and device ledger with full-cycle
  percentages, confidence labels, and a visible unattributed fallback. The
  separate global device-share chart remains available for comparison.
- Added three numeric visual-allocation tests and expanded Chromium E2E to
  assert `18.4% + 16.4% = 34.8%` in the main quota instrument. Desktop and
  mobile screenshots were inspected; the center reset text was split into two
  stable lines after that review. The local unit/integration total is now 33.
- GitHub Actions run `33045883774` passed on implementation commit `e268c0a`:
  Ubuntu verification, Windows verification, Chromium E2E, and the Docker
  container build all completed successfully.
