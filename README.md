# Consultation Readiness and Continuous Follow-up in Diabetes Care

Final-year major project, also entered in Health-a-thon 2026.

A clinician photographs a handwritten prescription or a printed laboratory
report. The system reads it, checks what it read against a closed drug list, and
shows the clinician a value only if that value can be traced back to a region on
the page it came from. Anything it cannot stand behind goes to a person, with
the cropped image, to settle in seconds.

The prescription it has just read becomes the patient's daily checklist, and
what she records between visits reaches her doctor without anyone typing it in.

## The boundary

The system is assistive, not diagnostic. It does not diagnose, recommend
treatment, stratify clinical risk, or return anything interpretive to the
patient. That boundary is enforced in the schema rather than in code review:
`audit.schema_guardrail_violations` fails the build if a judgement column
appears in `core`, `pat` or `proj`.

The one approved exception is the clinician-facing compliance score, which is
computed from medication ticks only and is never shown to the patient. See the
scope document.

## Documents

| File | What it is |
| --- | --- |
| [docs/Prototype-Scope.pdf](docs/Prototype-Scope.pdf) | What is in scope, what is out, what finished means, and the cut list |
| [docs/work-split.md](docs/work-split.md) | The two parallel tracks, week by week |
| [db/schema.sql](db/schema.sql) | PostgreSQL 16 schema, 44 tables, validated against a live database |

## Dates

- Build window: 13 October to 8 November 2026
- Feature freeze: Wednesday of the final build week
- Demonstration: 28 November 2026

## Constraints

- No real patient data at any stage.
- PostgreSQL 16. The schema needs the `citext` extension.
