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
| device       | focused used ring = device estimates   | next reset         |
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

The **quota horizon** is a large concentric time instrument. The focused ring's
total length and center number are the official used percentage, while colored
subsegments directly encode each device's estimated percentage of the complete
quota cycle. An adjacent ruled ledger repeats those percentages with confidence
and unattributed labels. Other rings remain compact official window traces, and
the center keeps remaining quota and reset time in two deliberate lines. It is
not decorative: it makes the official total and its estimated device
explanation readable in one glance without presenting the explanation as an
official per-device bill.

## Self-critique before build

The initial idea used a familiar grid of generic statistic cards. That could
belong to any analytics product and did not express the cross-location research
workflow. The revised design makes devices a persistent rail, makes the quota
window a time instrument, and uses ruled "bench plates" only where a comparison
needs a boundary. Motion is limited to the initial horizon sweep and live-status
pulse, with `prefers-reduced-motion` respected.
