# Handoff: state of the build and what comes next

Last updated 28 October 2026, after Track B's product pass: fixes from the
critique of the four demonstration pages, a fuller patient list and patient
header, prescriptions on the Documents tab, a settings screen and icon for
the patient app, the seed's audit history, and the patients' SMS card.
Written for Abbas and for any agent working on Track A.
Read `AGENTS.md` first; everything here sits under its rules.

## In one paragraph

Every interface surface in the scope exists: the clinician web app
(`apps/clinic`) and the patient Android app (`apps/patient`, Expo). Every
clinician screen except upload now runs on real endpoints (`api/`). Upload
still runs against a typed mock, because the reading pipeline behind it is
Track A's. The patient app runs on its endpoints (`/api/app/...`) when
`EXPO_PUBLIC_API_URL` is set, and on its in-memory mock otherwise. The
patient app is called cliniConnect, as both tracks agreed. The name is a
brand, so Hindi and Urdu write it in Latin letters too; neither it nor the
icon names the condition on the phone's home screen.

## What is real and what is mocked

| Surface | Path | Data |
| --- | --- | --- |
| Confirm queue | `apps/clinic/src/confirm-queue` | Real |
| Patient list, Documents tab, trace view | `apps/clinic/src/record`, `src/trace` | Real |
| Checklist and prescription review | `apps/clinic/src/checklist` | Real |
| Timeline | `apps/clinic/src/timeline` | Real |
| Visit page and compliance score | `apps/clinic/src/visit` | Real (score computed on read, see below) |
| Paper form | `apps/clinic/src/paperform` | Real |
| Today (the clinic's day, start page) | `apps/clinic/src/today` | Real |
| How a document was read | `apps/clinic/src/reading` | Real (checks come from the seed until the pipeline writes them) |
| Audit log | `apps/clinic/src/audit` | Real |
| Upload | `apps/clinic/src/upload` | Mock (stands in for the reading pipeline) |
| Patient app, including earlier days | `apps/patient` | Real when `EXPO_PUBLIC_API_URL` is set (`src/data/httpApi.ts`) |

The browser mock layer now serves upload only. The other handlers in
`apps/clinic/src/mocks/handlers` are fixtures for the Vitest screen tests,
typed against the generated schema; the API tests in `api/tests` define
the behaviour.

The real seed is a stand-in too: `api/dev_seed` writes four fictional
patients, a lab report each, prescriptions with a box per line (two
activated, two awaiting review), test orders, the question bank, a past
visit and one booked for today (10:00 to 11:30, half an hour apart), the
five check results for every value read, four weeks of patient entries
up to yesterday, and the audit history of all of it (`dev_seed/history.py`:
every confirmed line, activation, past visit read and patient entry, written
through `record_event` at the time it happened, so the chain checks out).
The tests seed with `--no-history` and start from an empty chain. Track A's
seed script should replace it, keeping the same four registration numbers
(DEV-0001 to DEV-0004).

## Endpoints

### Built by Track B

| Endpoint | Tests |
| --- | --- |
| `GET /api/patients/{id}/entries?from&to` | `api/tests/test_entries.py` |
| `GET /api/paper-form/questions`, `POST /api/patients/{id}/paper-form` | `test_paper_form.py` |
| `/api/app/...`: patients, today, ticks, readings, answers, meals, survey | `test_patient_app.py` |
| `GET /api/patients/{id}/checklist`, `GET /api/regimens/{id}/review`, `POST /api/regimen-items/{id}/confirm`, `DELETE /api/regimen-items/{id}`, `POST /api/regimens/{id}/activate`, `GET /api/regimen-items/{id}/crop` | `test_regimens.py` |
| `GET /api/patients/{id}/visit` | `test_visit.py` |
| `POST /api/sms/inbound` (gateway stand-in, `X-Gateway-Key`) | `test_sms.py`, `test_sms_parser.py` |
| `GET /api/clinic-day?date` | `test_clinic_day.py` |
| `GET /api/documents/{id}/reading` | `test_reading.py` |
| `GET /api/audit-log?kind&before&limit` | `test_audit_log.py` |
| `GET /api/app/patients/{id}/days?before&count` | `test_past_days.py` |
| `GET /api/storage/{key}?width` (a smaller copy of a photo, metadata removed) | `test_thumbnails.py` |
| `GET /api/patients` now returns `PatientListItem`: the old fields plus enrolment date, caregiver, last and next visit, the checklist in force, values and lines waiting, documents, the latest entry, and `sms_phone_last4` (the phone SMS is read from, only while the patient agrees to SMS) | `test_patient_list.py` |

The last six were added after the OpenAPI spec was frozen, for the
demonstration. Each only adds a path, an optional parameter or fields;
nothing existing was removed or renamed. In the earlier days endpoint a
tick's `ticked` is now `null` for a medicine on that day's checklist that
nothing was marked for, and the medicines come in checklist order. They need
agreeing like any other contract change.

`record_event` takes an optional `occurred_at`. Only the seed passes it,
to write history; every request leaves the time to the database clock.

The English interface strings gained the product pass's wording: the
header, footer and not-found page, the patient list and header (with the
patient's SMS phone), the retry message, the reading page's check summary,
the SMS card page, and the patient app's settings with its confirmation
before changing the patient (in all three languages). The SMS card's own
patient-facing wording is in `apps/clinic/src/smscard/cardStrings.ts`.
Those additions need agreeing too.

The clinic's SMS number is typed on the SMS card page and kept in that
computer's browser storage, because there is no gateway number to store
yet. When a gateway exists, it belongs in a clinic setting on the API.

How a document was read lists, for each value, the five checks from
`core.check_result`. Only the seed writes those rows today: the reading
pipeline should write one per check per value, so the page shows what the
deterministic layer actually decided.

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
9. **Nothing enforces append-only on `audit.event`.** The table comment says
   grants are INSERT and SELECT only, but the schema has no GRANT, REVOKE or
   trigger, so the app's own role can update a row. The audit log page
   rechecks the whole hash chain on every load and names the first row that
   does not follow (tested by editing a row), but the chain only detects a
   change; a grant or a trigger would prevent one.

## Not finished

- **Hindi and Urdu strings are drafts.** `apps/patient/src/i18n/hi.ts` and
  `ur.ts` are marked `REVIEWED = false`, and a test keeps them that way until
  a speaker reviews every string. Do not use them at the demonstration
  before then. The clinician app is English only, except the SMS card it
  prints for a patient (`apps/clinic/src/smscard/cardStrings.ts`), whose
  Hindi and Urdu are drafts under the same rule.
- **A day's answer can be changed in the app,** and each answer is stored
  as its own entry, so the clinician sees both, with their times. There is
  no supersede link between them.
- **Meal photos** are stored under `storage/meals/`, never committed. The
  patient app endpoints have no authentication, as the scope allows. A
  photo from a phone keeps its camera metadata, which can include where it
  was taken. The small copies the screens show have none; whether to strip
  it from the original too is a decision for both of us.
- **SMS** is built as an inbound endpoint with no reply (notifications are
  out of scope). The message format is in the README. The clinic prints each
  patient's SMS card from their Checklist tab; a patient who has not agreed
  to SMS gets no card. The card leaves a line for the clinic's SMS number,
  because there is no gateway number yet.
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

- Every route's database dependency runs at `scope="function"` (see
  `api/src/healthathon/auth.py`), so the commit happens before the
  response is sent. A new dependency with `yield` must do the same; a test
  checks every route.

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

## Waiting on Track A (Abbas): the patient features of 28 October

Built on `dev/saadat` after PR #9, not yet committed when this was written.
Each needs Abbas's agreement, because it changes a frozen artefact.

**Schema (`db/schema.sql`), all nullable or loosened, the guardrail view still empty:**
- `pat.meal` enum (breakfast, lunch, dinner, snack) and two columns on
  `pat.meal_photo`: `meal` and `calories_text`. `calories_text` is only ever
  what the patient typed, digits only, never estimated or added up. This
  reverses the old comment that said there is no calorie column; the
  scope's ban is on estimates from a photograph, which this is not.
- `pat.survey_answer.answer_text` may now be NULL, with a new `audio_key`
  and a CHECK that one of them is present: a spoken answer is kept as a
  recording and not transcribed.
- Apply to an existing database by hand (there are no migrations yet):
  `CREATE TYPE pat.meal ...; ALTER TABLE pat.meal_photo ADD COLUMN meal pat.meal, ADD COLUMN calories_text text CHECK (...); ALTER TABLE pat.survey_answer ALTER COLUMN answer_text DROP NOT NULL, ADD COLUMN audio_key text, ADD CONSTRAINT answer_given CHECK (answer_text IS NOT NULL OR audio_key IS NOT NULL);`

**OpenAPI:**
- `POST /meals` requires `meal`, takes `taken_at` and `calories`; the entry
  happens when the photo was taken. `AppMeal` and `MealPhotoEntry` gain
  `meal` and `calories_text`.
- `POST /api/app/patients/{id}/recordings` stores a recording (m4a, WebM,
  Ogg, WAV; 5 MB at most) and returns its key. Answers take `audio_key`;
  the survey takes `recordings` by question key. `AnswerEntry` gains
  `audio_url`; `Today` gains `answer_audio_uri`; past answers gain `audio_uri`.
- **Patient sign-in.** `POST /api/app/sign-in/start` and `/sign-in/check`.
  Every `/api/app/patients/{id}/...` route now needs
  `Authorization: Bearer <token>` for that patient (401 without, 403 for
  another patient). `GET /api/app/patients`, the unauthenticated list of
  patients, is gone. CORS allows the `Authorization` header.

**Sign-in, for deployment:** codes go through Twilio Verify when
`HEALTHATHON_TWILIO_ACCOUNT_SID`, `_AUTH_TOKEN` and `_VERIFY_SID` are set.
Without them the API is in test mode and shows the code on screen: never
deploy without the keys, and set `HEALTHATHON_SESSION_SECRET`. To receive a
real code on a demo patient: `uv run python -m dev_seed --phone DEV-0001=+91...`.

**Not built, by decision:** AI advice to patients from food labels. It
breaks the project's first rule (nothing interpretive to the patient, no
treatment suggestions). Changing that rule is a team and clinical decision.

## Next steps

**Track A (Abbas)**

1. Seed script, replacing `api/dev_seed`, with the same four registration numbers.
2. Answer schema questions 1, 5 and 7, then the reading pipeline behind
   `POST /api/uploads`, writing regimens and test orders as above.
3. `pat.compliance_score` migration and the guardrail change, then store the
   score the visit endpoint computes.

**Track B (Saadat)**

1. Get the Hindi and Urdu strings reviewed by speakers.
2. Run the patient app on an Android phone.
3. Wire upload once the pipeline lands, then `/impeccable audit`.
