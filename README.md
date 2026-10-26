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

## Development

| Path | What it is |
| --- | --- |
| `api/` | FastAPI service over the schema. Python 3.12, managed with `uv` |
| `api/openapi.json` | The API contract. A test fails if it drifts from the code |
| `api/dev_seed/` | Stand-in seed: four fictional patients with generated lab reports, until the Track A seed script lands |
| `apps/clinic/` | Clinician web app. Vite, React, TypeScript |
| `apps/patient/` | Patient Android app. Expo, tested on its web target |
| `docs/HANDOFF.md` | What is real, what is mocked, and what comes next |

Requires Docker, `uv`, and Node 20 or later.

```
docker compose up -d                      # PostgreSQL 16 on 127.0.0.1:5434, schema loaded
cd api && uv sync
uv run python -m dev_seed                 # fictional data; --reset to start again
uv run uvicorn healthathon.main:app --reload --port 8000

npx npm@11 install                        # from the repo root (npm 10 crashes here)
npm run clinic                            # http://127.0.0.1:5173
cd apps/patient && npx expo start         # patient app: a for Android, w for web
```

Page images and crops go to `storage/`, which is never committed.

### Tests

Every layer is tested, and every one of these must pass before a commit.

```
# api/
uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest

# apps/clinic/
npm run check      # types, lint, unit tests
npm run e2e        # Playwright against the real API and a real database

# apps/patient/
npm run check      # types and Jest
npm run e2e        # Playwright and axe on the Expo web build
```

`pytest` builds `healthathon_test` from `db/schema.sql`, and the end-to-end
suite builds `healthathon_e2e` and reseeds it before every test. The
schema guardrail runs as part of `pytest`. After changing the API, run
`uv run python -m healthathon.export_openapi` and agree the change with the
other track.
