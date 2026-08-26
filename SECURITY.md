# Security policy

## Supported version

The current `main` branch is the only supported development line until the
first tagged release.

## Reporting a vulnerability

Please use the repository's private GitHub security-advisory form. Do not open
a public issue containing credentials, private Codex data, local paths, or a
working exploit against an Internet-facing deployment.

Include the affected version/commit, the smallest safe reproduction, impact,
and any proposed mitigation. Replace all group keys, device tokens, account
identifiers, prompts, code, and paths with synthetic values.

## Product boundary

QuotaLab is intended for a small trusted group. Anyone holding the group key can
view its aggregates and enroll a device. QuotaLab never needs an OpenAI API key
and should never be given one. See [`docs/PRIVACY.md`](docs/PRIVACY.md) for the
full data boundary.
