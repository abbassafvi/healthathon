# Handoff: state of the build and what comes next

Last updated 27 October 2026, after Track B built the patient, regimen and
visit endpoints and wired the clinician screens to them (PRs #4 to #6,
stacked on #3). Written for Abbas and for any agent working on Track A.
Read `AGENTS.md` first; everything here sits under its rules.

## In one paragraph

Every interface surface in the scope exists: the clinician web app
(`apps/clinic`) and the patient Android app (`apps/patient`, Expo). Every
clinician screen except upload now runs on real endpoints (`api/`). Upload
still runs against a typed mock, because the reading pipeline behind it is
Track A's. The patient app's endpoints exist (`/api/app/...`); wiring the
app to them is the next Track B step.

## What is real and what is mocked

| Surface | Path | Data |
| --- | --- | --- |
| Confirm queue | `apps/clinic/src/confirm-queue` | Real |
| Patient list, Documents tab, trace view | `apps/clinic/src/record`, `src/trace` | Real |
| Checklist and prescription review | `apps/clinic/src/checklist` | Real |
| Timeline | `apps/clinic/src/timeline` | Real |
| Visit page and compliance score | `apps/clinic/src/visit` | Real (score computed on read, see below) |
| Paper form | `apps/clinic/src/paperform` | Real |
| Upload | `apps/clinic/src/upload` | Mock (stands in for the reading pipeline) |
| Patient app | `apps/patient` | Endpoints real; the app still uses its in-app mock |

The browser mock layer now serves upload only. The other handlers in
`apps/clinic/src/mocks/handlers` are fixtures for the Vitest screen tests,
typed against the generated schema; the API tests in `api/tests` define
the behaviour.

The real seed is a stand-in too: `api/dev_seed` writes four fictional
patients, a lab report each, prescriptions with a box per line (two
activated, two awaiting review), test orders, the question bank, a past and
a booked visit, and four weeks of patient entries up to yesterday. Track A's
seed script should replace it, keeping the same four registration numbers
(DEV-0001 to DEV-0004).

## Endpoints

### Built by Track B (PRs #4, #5)

| Endpoint | Tests |
| --- | --- |
| `GET /api/patients/{id}/entries?from&to` | `api/tests/test_entries.py` |
| `GET /api/paper-form/questions`, `POST /api/patients/{id}/paper-form` | `test_paper_form.py` |
| `/api/app/...`: patients, today, ticks, readings, answers, meals, survey | `test_patient_app.py` |
| `GET /api/patients/{id}/checklist`, `GET /api/regimens/{id}/review`, `POST /api/regimen-items/{id}/confirm`, `DELETE /api/regimen-items/{id}`, `POST /api/regimens/{id}/activate`, `GET /api/regimen-items/{id}/crop` | `test_regimens.py` |
| `GET /api/patients/{id}/visit` | `test_visit.py` |

### Still to build (Track A)

| Endpoint | Contract | Mock and its tests | Rules the mock enforces |
| --- | --- | --- | --- |
| `POST /api/uploads`, `GET /api/uploads/{id}` | `UploadRequest` -> `UploadStatus` in `apps/clinic/src/api/pending.ts` | `src/mocks/handlers/upload.ts` | Idempotent by capture id; duplicate by `(patient, sha256)` only after a successful read; a prescription produces a regimen awaiting review |

The reading pipeline behind upload writes what the built endpoints read:
`core.document` and pages, `extracted_value` with provenance, queue items,
and for a prescription a `core.regimen` with one `regimen_item` per line,
each with a `source_document` provenance box. Test orders it reads go to
`core.test_order` with their own box.

### How to wire one endpoint

1. Build it in `api/`, with tests against Postgres (copy the mock's tests).
2. `uv run python -m healthathon.export_openapi`, then agree the contract change.
3. Move its types from `pending.ts` to the generated schema (`npm run api-types`).
4. Delete its mock handler and the handler's tests.
5. Run the full suites (below). The e2e specs for that screen should then
   run against the real API: drop the mock from their setup.

## Schema questions for Track A

These came up while building and need a decision from the schema owner.

1. **Drug names cannot reach the confirm queue.** `confirm_queue_item`
   points at `extracted_value`, which requires an `analyte_code`. A drug read
   from a handwritten prescription has no analyte, and `regimen_item` has no
   queue link. The UI handles prescriptions through review and activation
   instead, but "finished" criterion 1 expects drug names with boxes.
2. **A plain confirm stores its latency only in the audit log.** Corrections
   and discards go to `value_correction`. Decide whether confirms need a
   column or table of their own.
3. **`candidate_readings` shape.** The UI uses
   `[{ "value_text": ..., "unit_text": ... }]`. The pipeline must write the same.
4. **`pat.compliance_score`** needs its migration and the narrowed guardrail
   exception (week 3 in the work split). Until it exists, `GET .../visit`
   computes the score on read (`api/src/healthathon/visit/compliance.py`):
   ticked cells over all cells, one cell per item per day from activation,
   rounded half up. Store exactly that result. The UI refuses a score that
   disagrees with a recount of its days (`apps/clinic/src/visit/score.ts`).
5. **Regimen item corrections.** A correction updates the item's text in
   place; the original reading and the decision latency are in the audit
   event (`regimen_item.correct`). Decide whether `regimen_item` needs a
   supersede chain like `extracted_value`.
6. **Test orders.** Only the seed writes `core.test_order`. The visit page
   counts an order as matched only when its value is in
   `proj.renderable_value`, so a value still in the queue is not a match.
7. **Daily question or survey question?** `pat.question_bank_item` has no
   column that says which. The daily key is named in
   `api/src/healthathon/entries/repository.py`; survey answers carry
   `set_id`, daily ones do not.
8. **Patient writes have no clinic user.** `audit.event.actor_id` is
   nullable, and patient app writes are recorded with no actor; the entity
   id leads to the entry and the patient.

## Not finished

- **Hindi and Urdu strings are drafts.** `apps/patient/src/i18n/hi.ts` and
  `ur.ts` are marked `REVIEWED = false`, and a test keeps them that way until
  a speaker reviews every string. Do not use them at the demonstration
  before then. The clinician app is English only.
- **The patient app still uses its in-app mock.** The endpoints exist;
  the HTTP client that implements `PatientApi` is next.
- **A tick cannot yet be recorded as "not taken" in the patient app.** The
  endpoint takes `ticked: false`; the app's toggle does not send it yet.
- **Meal photos** are stored under `storage/meals/`, never committed. The
  patient app endpoints have no authentication, as the scope allows.
- **The SMS endpoint** (scope: Other routes) has no UI and is not built.
- **Native Android** has not been run on a device or emulator; the patient
  app is tested on Expo's web target. Run it on a phone before rehearsal.

## Running and testing

See the README for setup. Every suite must pass before a commit.

```
# api/
uv run ruff check . && uv run ruff format --check . && uv run mypy && uv run pytest

# apps/clinic/
npm run check        # types, lint, unit tests (stops on the first failure)
npm run e2e          # Playwright and axe, real API and Postgres plus the mocks

# apps/patient/
npm run check        # types and Jest
npm run e2e          # Playwright and axe on the Expo web build
```

Things that will trip you up:

- Use `npx npm@11` (or npm 11 on `PATH`). npm 10.8 crashes on this workspace.
  `npx expo install` shells out to whichever npm is on `PATH`.
- React is pinned to 19.3.0 for the whole repo through `overrides` in the
  root `package.json`, because Expo SDK 58 requires exactly that version.
  Do not raise it in one app only.
- The clinic's mock layer runs as a service worker in dev. Playwright's
  `page.route` cannot see requests that pass through it, so specs that
  intercept real requests call `withoutMocks(page)` (`e2e/mocks.ts`). Set
  `VITE_MOCKS=off` to run the app without mocks.
- Key listeners attach in layout effects, not passive ones, so a key works in
  the same commit that enables its button. Keep it that way; a passive effect
  reintroduced a race once.

## Next steps

**Track A (Abbas)**

1. Seed script, replacing `api/dev_seed`, with the same four registration numbers.
2. Answer schema questions 1, 5 and 7, then the reading pipeline behind
   `POST /api/uploads`, writing regimens and test orders as above.
3. `pat.compliance_score` migration and the guardrail change, then store the
   score the visit endpoint computes.

**Track B (Saadat)**

1. Wire the patient app to `/api/app/...`; add the "not taken" tick.
2. Get the Hindi and Urdu strings reviewed by speakers.
3. Run the patient app on an Android phone.
4. SMS endpoint, if the cut list allows.
5. `/impeccable critique` and `/impeccable audit` again after wiring.
