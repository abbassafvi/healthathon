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
| `api/src/healthathon/uploads/` | The reading pipeline: PaddleOCR finds the regions, a document agent reads them |
| `apps/clinic/` | Clinician web app. Vite, React, TypeScript |
| `apps/patient/` | Patient Android app. Expo, tested on its web target |
| `docs/HANDOFF.md` | What is real, what is mocked, and what comes next |

Requires Docker, `uv`, and Node 20 or later. Reading a real photograph
also needs the detector and a model key; see "Reading a document" below.

```
docker compose up -d                      # PostgreSQL 16 on 127.0.0.1:5434, schema loaded
cd api && uv sync
uv run python -m dev_seed                 # fictional data; --reset to start again
uv run uvicorn healthathon.main:app --reload --port 8000

npx npm@11 install                        # from the repo root (npm 10 crashes here)
npm run clinic                            # http://127.0.0.1:5173
cd apps/patient && EXPO_PUBLIC_API_URL=http://10.0.2.2:8000 npx expo start
                                          # patient app: a for Android, w for web
```

The patient app talks to the API at `EXPO_PUBLIC_API_URL`: `http://10.0.2.2:8000`
from the Android emulator, the computer's LAN address from a phone (start
uvicorn with `--host 0.0.0.0`), or `http://127.0.0.1:8000` for the web
target. Without it the app runs on its in-memory mock.

Page images and crops go to `storage/`, which is never committed.

### Reading a document

A page is read in two steps. PaddleOCR finds every region that holds
writing, and only that: its recogniser is never run. Each region is cut
out and shown to a document agent, one per document type, which reads
the crop and must cite the region every reading came from. A reading
that cites no region is dropped, so nothing reaches the record that
cannot be pointed at on the page.

The detector is an optional install, because paddlepaddle is a few
hundred megabytes and nothing but a real read needs it:

```
cd api && uv sync --extra ocr
```

The agent needs a key. Gemini through AI Studio is free and needs no
card; anything speaking the OpenAI chat protocol works too. Set these
outside git:

```
HEALTHATHON_AGENT_API_KEY=...
HEALTHATHON_AGENT_PROVIDER=gemini        # or: openai
HEALTHATHON_AGENT_MODEL=gemini-2.5-flash
HEALTHATHON_AGENT_BASE_URL=...           # "openai" only, e.g. Groq or OpenRouter
```

Without a key the API stores the page and refuses to read it, rather
than guessing: an unread page can be read again, an invented value
cannot be taken back.

Each page is read three times and the passes are compared, which is the
"ask again" check: a reading that changes between passes is not trusted.
That costs three requests per page, and Gemini's free tier allows twenty
a day, so about six pages. `HEALTHATHON_AGENT_READS=1` trades the check
for about twenty pages instead.

`HEALTHATHON_LEGIBILITY_MIN_SHARPNESS` is the floor a region must clear
to be read without a person. It is measured rather than chosen: see the
figures in `config.py`. It separates blur from legible writing, and does
not see smudging at all.

### What decides where a reading goes

Every reading runs the five checks, and the share it passes is its
confidence, from 0 to 1. A check that did not apply, because the report
carries no date or the page was read once, is left out of both sides
rather than counted against the reading. Grounding is a gate rather than
a share of the score: a reading with no region on the page scores 0,
because there is nothing to point at and nothing to show a person.

The number never comes from the model. A reader's own certainty is the
one thing that cannot be audited, so the score is built from the checks
alone.

A prescription line is settled the same way. Four of the five checks
apply to a medicine, with the dose checked for a quantity and a unit a
dose is measured in. A line that passes every check it ran is accepted
and needs nobody; one that does not waits for a clinician beside its
crop. An accepted line never carries a clinician's name, because the
record must not say a person looked at something nobody looked at.

At or above `HEALTHATHON_CONFIDENCE_THRESHOLD` the reading joins the
record with its box. Below it, the reading waits in the confirm queue
with its crop, and a clinician reads that region themselves. The
threshold defaults to 1.0, meaning every check that applied has to
pass. That is deliberately strict: the number is only as good as the
gold set it was tuned against, and there is no gold set yet.

`HEALTHATHON_DETECTOR=stub` and `HEALTHATHON_AGENT_PROVIDER=stub` select
a built-in stand-in that needs neither paddlepaddle nor a network. The
browser tests run on it. It is for development only and never reads a
real document.

### Patient sign-in

A phone signs in with the mobile number on the patient's record and a code
sent to it by SMS through Twilio Verify. Set these outside git:

```
HEALTHATHON_TWILIO_ACCOUNT_SID=AC...
HEALTHATHON_TWILIO_AUTH_TOKEN=...
HEALTHATHON_TWILIO_VERIFY_SID=VA...
HEALTHATHON_SESSION_SECRET=<a long random value>
```

Without the Twilio values the API is in test mode: no SMS is sent, and the
sign-in screen shows the code (it is also in the API's log). The seed's
fictional patients use 55500 00001 to 55500 00004. To have a real code
reach your own phone, put your number on a demo patient in your local
database only: `uv run python -m dev_seed --phone DEV-0001=+91XXXXXXXXXX`.
Never deploy in test mode.

### SMS

`POST /api/sms/inbound` stands in for an SMS gateway. The patient writes one
instruction per line, from the card the clinic gives them. The clinic prints
the card from the patient's Checklist tab ("SMS card"), in the language the
patient reads, with their medicines numbered as the reader counts them:

| Message | Means |
| --- | --- |
| `G 142 F` | Glucose 142, before breakfast. Contexts: F fasting, B before a meal, A after a meal, N bedtime, O overnight, R another time. A number without a context is refused. |
| `T 2 Y` | Medicine 2 on the checklist taken (`N`: not taken) |
| `Q <words>` | The answer to the day's question, as written |

```
curl -X POST http://127.0.0.1:8000/api/sms/inbound \
  -H 'Content-Type: application/json' -H 'X-Gateway-Key: dev-only-gateway-key' \
  -d '{"message_id": "demo-1", "from": "+91 55500 00001", "body": "G 142 F\nT 1 Y"}'
```

The seed gives each patient a fictional number, `+91 55500 0000N`; Rakesh
Yadav (DEV-0004) has not agreed to SMS, so his messages are refused. Set
`HEALTHATHON_PHONE_HMAC_KEY` and `HEALTHATHON_SMS_GATEWAY_KEY` outside
development.

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
npm run e2e        # Playwright and axe on the Expo web build, against the real API
```

`pytest` builds `healthathon_test` from `db/schema.sql`, and the end-to-end
suite builds `healthathon_e2e` and reseeds it before every test. The
schema guardrail runs as part of `pytest`. After changing the API, run
`uv run python -m healthathon.export_openapi` and agree the change with the
other track.
