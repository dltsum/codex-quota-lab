# Dashboard design direction

## Subject and job

Subject: a graduate student's shared Codex quota across home, desk, lab, and
internship computers. Audience: a small trusted research group. Single page
job: decide where and how heavily to run the next task before a quota window
closes.

## Visual system

- `Porcelain` `#F4F7F5`: quiet instrument background.
- `Deep ink` `#162338`: primary text and structural rules.
- `Cobalt` `#3157FF`: official quota observations.
- `Signal coral` `#FF6B52`: warnings and unattributed usage.
- `Bench mint` `#8FD5C1`: healthy/local-measurement state.
- `Graphite` `#697586`: secondary labels.

Typography uses Archivo Variable for compact display headings, Manrope Variable
for readable interface copy, and IBM Plex Mono for percentages, timestamps, and
model names. Fonts are bundled; the dashboard does not depend on a font CDN.

## Layout candidates

Candidate A — instrument bench (selected):

```text
+ device rail +---------- quota horizon ----------------+ sync / confidence +
| device       |      concentric official windows       | data quality       |
| device       |     remaining time inside the dial     | next reset         |
+--------------+-----------------------------------------+--------------------+
| device share | model mix | effort mix | purpose mix | launch surfaces      |
+----------------------------------------------------------------------------+
| official percentage history + activity lane                                |
+----------------------------------------------------------------------------+
```

Candidate B — dense ledger: excellent for export review but weaker for the
immediate "may I start another task?" decision, so it remains the accessible
table fallback rather than the main composition.

## Signature

The **quota horizon** is a large two-ring time instrument: ring length is the
official used percentage, a moving marker shows time until reset, and its center
states the remaining percentage in plain language. It is not decorative; it
keeps the two facts the user actually controls in one glance.

## Self-critique before build

The initial idea used a familiar grid of generic statistic cards. That could
belong to any analytics product and did not express the cross-location research
workflow. The revised design makes devices a persistent rail, makes the quota
window a time instrument, and uses ruled "bench plates" only where a comparison
needs a boundary. Motion is limited to the initial horizon sweep and live-status
pulse, with `prefers-reduced-motion` respected.
