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
| Upload | `apps/clinic/src/upload` | Real (the reading pipeline, `api/src/healthathon/uploads`) |
| Patient app, including earlier days | `apps/patient` | Real when `EXPO_PUBLIC_API_URL` is set (`src/data/httpApi.ts`) |

The browser mock layer is gone: upload was the last endpoint it served.
`apps/clinic/src/mocks/handlers` is now fixtures for the Vitest screen
tests alone, typed against the generated schema; the API tests in
`api/tests` define the behaviour. `withoutMocks` and `VITE_MOCKS` went
with it, because there is no service worker left to hide a request from
Playwright's `page.route`.

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

### The reading pipeline

`POST /api/uploads` now carries the photograph itself, as multipart, and
`GET /api/uploads/{id}` reports the read. Tests: `api/tests/test_uploads.py`
(through Postgres) and `api/tests/test_uploads_reader.py` (the pure parts).

A page is read in two steps, which is the whole point of the design:

1. **PaddleOCR, detection only.** Its recogniser is never run. The
   detector returns one box per region holding writing, in reading order,
   normalised to the page. The boxes are also drawn onto a `boxes.png`
   beside the page, so what was looked at can be seen.
2. **A document agent reads the crops.** One per document type, with its
   own prompt: `prescription_prompt` and `lab_report_prompt`. Every
   reading must cite the index of the crop it came from, and
   `drop_ungrounded` removes anything citing a region that was never
   shown. The agent never sees the patient's record.

The same five checks then run per laboratory value and per prescription
line (`uploads/checks.py`) and the share
the reading passed becomes its confidence, 0 to 1 (`checks.confidence`).
Grounding gates it: no region, no score. A check that did not apply is
left out of both sides. The number is built from the checks and never
from the model, because a reader's own certainty cannot be audited.

At or above `HEALTHATHON_CONFIDENCE_THRESHOLD` (default 1.0, strict on
purpose until there is a gold set to tune against) the value joins the
record. Below it the value is written `needs_confirm` and queued with
its crop, and the queue item still names the check that failed rather
than only the number. Each value's score and the threshold in force are
kept in `extraction_run.raw_output`, so a decision can be reread later.

The five `check_result` rows are still written per value. The score is
derived for routing, not stored in place of them, so per-check ablation
and the named confirm reason both still work. A prescription line is
never written as a value: it becomes a `regimen_item` awaiting a
clinician, with its own `source_document` provenance. Test orders go to
`core.test_order` with their own box.

The agent runs on a free-tier provider: Gemini through AI Studio by
default, or anything speaking the OpenAI chat protocol. Without a key the
API stores the page and fails the read rather than guessing. See the
README.

A prescription's regions are merged into whole lines before cropping.
A medicine is written across the line, with the drug on the left and the
dose further right, and the detector finds each as its own region: asked
for a medicine with a drug and a dose citing one region, the agent could
only answer with nothing, which is what it did on the first real
photograph. A laboratory report is never merged, because a value
pointing at a whole row points at the wrong number.

### A page sent from the patient's phone

The same pipeline, a second door. `POST /api/app/patients/{id}/documents`
takes the photograph as a raw body with `capture_id` and `doc_type`,
returns at once, and the phone polls
`GET /api/app/patients/{id}/uploads/{upload_id}`. The intake is opened on
the `patient_app` channel with `uploaded_by` NULL, because no clinic user
touched the page and the audit must not say one did. Both values were
already in the schema; nothing under `db/` changed for this.

The reading therefore lands on the same record. A prescription a patient
sends appears in that patient's checklist awaiting review, a lab report's
values go to the confirm queue, and `GET /api/patients/{id}/checklist`,
`/record` and `/documents/{id}/reading` now all carry `sent_from`, so a
clinician settling a line knows whether the page was photographed at the
desk or sent in.

What the patient sees back is `GET /api/app/patients/{id}/documents`: the
page and the readings as written, each saying whether a clinician has
settled it. A laboratory number is absent until it is settled, because
`proj.renderable_value` is the only view a value may be read from and it
admits nothing in `needs_confirm`. Medicines and advice are not behind
that view, so those are shown with an explicit "not checked yet" marker
rather than hidden.

Tests: `api/tests/test_patient_documents.py`, the patient app's
`DocumentsScreen.test.tsx`, and one end-to-end case in
`apps/patient/e2e/patient.spec.ts` that photographs a page on the phone
and then reads the clinician's checklist to find it.

### A prescription line is settled the same way

A line is written with its box, then checked. Four of the five apply: a
medicine has no second document to be compared against. `well_formed`
becomes `dose_well_formed`, which asks that a quantity is present and
that any word beside it is a unit a dose is measured in ("500 mg",
"10/100/1000", "1 tab" pass; "as directed" does not).

Reading the page three times decides the reread check. The line written
is the one most passes gave; a box they disagreed over is still written
and fails its reread check, so a clinician confirms it against the crop.
An earlier version demanded that every pass agree and dropped the line
otherwise, which on handwriting meant every medicine vanished: three
independent reads of handwriting differ somewhere nearly every time.

A line that passes every check it ran gets `regimen_item.accepted_at`
and needs nobody. A line that does not waits for a clinician, who sees
it beside its crop with the failed check named. Activation now requires
every line to be settled one way or the other, rather than confirmed by
a person in every case.

`accepted_at` and `confirmed_by` are separate columns on purpose. The
audit must never attribute to a person a line nobody looked at, so an
accepted line carries no clinician's name, and a clinician may still
confirm one.

**Schema change, needs agreeing (it is a frozen artefact):**

- `core.check_result.extracted_value_id` is nullable, and the table
  gains `regimen_item_id` with a CHECK that exactly one is set. The five
  checks now cover both kinds of reading in one table, so per-check
  ablation still works across both.
- `core.regimen_item` gains `accepted_at`, and a CHECK that
  `confirmed_at` and `confirmed_by` are set together.
- There are no migrations, so an existing database needs these by hand:
  `ALTER TABLE core.check_result ALTER COLUMN extracted_value_id DROP NOT NULL, ADD COLUMN regimen_item_id uuid; ALTER TABLE core.regimen_item ADD COLUMN accepted_at timestamptz;`
  plus the two CHECKs, the UNIQUE and the foreign key.

**What it does not do yet:**

- **A region the agent declined to read cannot be queued.** This is
  schema question 1 below in a second form: `confirm_queue_item` needs an
  `extracted_value`, which needs an `analyte_code`, and a region nobody
  could read has no analyte. Those indices are kept in
  `extraction_run.raw_output` so they are not lost, but no screen shows
  them. A queue that can hold a bare crop would fix both halves.
- **No normalise step.** `document_page.sharpness`, `contrast` and
  `skew_deg` are still never written, and nothing deskews or upscales a
  photograph before the detector sees it. This bites hardest on a
  handwritten prescription.
- **No drug list.** There is no table of drugs to match a read name
  against, so `drug_text` is whatever the agent read.
- **Smudging is invisible to the legibility check.** The floor is now
  measured (1450, see `config.py`), and it separates blur from legible
  text cleanly. It cannot separate smudging: strokes drawn over writing
  add edges, and edge variance is what the check counts, so a smudged
  crop scores 2062 to 3728 against clean text's 2349 to 3486. Catching
  smudging needs a different signal.
- **The calibration is on drawn pages, not photographs.** Real documents
  carry compression and uneven light, which may move the whole scale.
  Re-measure before the demonstration.
- **The page is read three times and the passes compared**
  (`HEALTHATHON_AGENT_READS`, default 3). A laboratory value that changed
  between passes goes to the queue as `readers_disagree`; a prescription
  line that changed is not written at all, because no queue stands
  behind a regimen item. Set 1 to read once, which costs a third as much
  and makes `reread_agreement` `not_applicable`.
- **One page per document.** `page_count` is always 1.
- **The read runs in a thread,** and the job's stage lives in memory. The
  durable answer is the intake, the document and the extraction run; a
  restart mid-read loses the stage, not the page.

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
   queue link. Half of this is now answered: a line carries its own
   `check_result` rows and its own `accepted_at`, so the deterministic
   layer settles it without a queue. What is still unanswered is where a
   region nobody could read at all goes, since that has no line either.
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

## Voice and paper surveys, 7 November

Added after the feature freeze, by agreement between both tracks. Each
change only adds: nothing existing was removed or renamed.

- **Paper survey photographs.** The Upload page has a third type, Paper
  survey. `POST /api/uploads` takes `doc_type=survey_form`, stores the page
  (`uploads/keep.py`) and returns `done` at once: no detector, no agent, no
  extraction run, no values. `PatientRecord` gains `survey_forms`, shown
  above the documents on the Documents tab. Typing the answers from paper is
  still the Paper form page. Tests: `api/tests/test_survey_forms.py`.
- **Dictation in the clinic.** A microphone beside the paper form's
  free-text answers and the patient search (`app/DictateButton.tsx`). It
  uses the browser's Web Speech API, so Chrome or Edge, on `localhost` or
  HTTPS; it is hidden where the browser has none. Chrome sends the audio
  to Google to be recognised. Deliberately not offered on values, doses,
  dates or phone numbers.
- **Spoken answers written down.** `HEALTHATHON_TRANSCRIBE_RECORDINGS=true`
  (off by default) sends each new recording to Gemini, on the document
  agent's key, and stores what it heard in `pat.recording_transcript`. This
  reverses the earlier rule that a recording never leaves the clinic, which
  is why it is a switch. The recording stays the answer. `AnswerEntry`
  gains `audio_transcript`, `Today` gains `answer_transcript`, past answers
  gain `transcript`; both apps show it under the player, labelled as
  machine-written. Tests: `api/tests/test_transcripts.py`.

Schema: `core.doc_type` gains `survey_form`, and `pat.recording_transcript`
is new. A database made before this needs:

```sql
ALTER TYPE core.doc_type ADD VALUE 'survey_form';
-- then the CREATE TABLE pat.recording_transcript statement from db/schema.sql
```

Found while testing the real reader on 7 November (Track A): on the seeded
DEV-0003 lab report, Gemini read three of four values and left out the
blurred serum creatinine in all three reads, without listing its region as
unreadable. So `raw_output.unreadable` was empty and the value left no trace
anywhere: not in the record, not in the queue, not in the run. The pipeline
relies on the model to report what it skipped, and it does not always.
A deterministic check would close it: a detected region in the value column
of a row whose test name was read, cited by no reading.

New English strings: `upload.surveyForm*`, `upload.submitKeep*`,
`upload.surveyDone`, `upload.openSurveys`, `record.survey*`, `dictation.*`,
`entries.spokenTranscribed`, `entries.transcript`, and the patient app's
`voice.heard` in all three languages (Hindi and Urdu are drafts).

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

## Automated voice calls

Written 7 November 2026 as a design, and the inbound half built the same
day on Abbas's instruction. The scope still excludes the feature and the
feature freeze has passed, so say that at the demonstration.

**Inbound is built.** `POST /api/voice/inbound` takes one step of one
call, matches the caller by `core.patient_phone.phone_hmac`, refuses
anything without a granted unwithdrawn `voice` consent, and stores key
presses through `inbound/store.py`, which the SMS path now shares. It is
off unless `HEALTHATHON_VOICE_GATEWAY_KEY` is set, and that is empty by
default, because no provider is chosen. Tests: `api/tests/test_voice.py`.

**Outbound is not built**, and is not just more code: see "What outbound
adds" below. It needs a dialable number, which reverses a privacy choice
in the frozen schema, and it is a notification, which the scope excludes
separately. Both are human decisions.

The design below is what was built against. None of the outbound part
exists in the code. The scope excludes
automated voice calls, because they need a telephony provider, an account and
a budget, and the SMS endpoint already proves the data path. Say so at the
demonstration. Building it needs both tracks to change the scope, and the
feature freeze has passed.

The design starts inbound: the patient rings a clinic number and answers by
keypad. Outbound can be added later on the same call flow.

### The call flow

1. The provider sends each step of the call to a new webhook, authenticated
   like `POST /api/sms/inbound`.
2. The caller ID is matched through `core.patient_phone.phone_hmac`. Without a
   granted, unwithdrawn `voice` consent, the call ends and nothing is stored.
3. Key presses become the instructions an SMS carries, and the same rules
   apply, such as one tick per medicine per day.
4. The call repeats what was entered ("142 recorded") and says nothing else
   about it. Nothing interpretive reaches the patient by voice either.

| Caller does | SMS equivalent |
| --- | --- |
| Chooses medicine 2, presses 1 for taken | `T 2 Y` |
| Enters 142#, then a key for the time of day | `G 142 F` |
| Speaks the day's answer | None: stored as a recording through `audio_key`, not transcribed |

Medicines go by the number on the patient's SMS card, so text-to-speech never
has to say a drug name.

### What changes in the code

`receive` in `api/src/healthathon/sms/service.py` hard-codes `sms` as the
channel, the consent item and the capture id prefix. Move the storing into a
function that takes those, and call it from both routes. Build capture ids
from the provider's call id and the step, so a repeated webhook stores once.

Inbound needs no schema change. `pat.entry.channel` and
`core.message_log.channel` are both `core.intake_channel`, which already has
`voice_call`, and `core.consent.item` already names `voice`. The OpenAPI spec
and the English strings do change, so both need agreeing.

### What outbound adds

- **A dialable number.** `core.patient_phone` stores only an HMAC and the last
  four digits. Outbound needs an encrypted number, which changes the frozen
  schema and reverses that privacy choice.
- **A scheduler.** It decides who to ring and when, how often to retry, and
  which hours are off limits.
- **A second scope change.** The system ringing a patient is a notification,
  and the scope excludes those separately.
- **A provider that can ring Indian numbers.** See below.

An unanswered call writes nothing. The compliance score counts a medicine with
no tick as not ticked, so a call nobody picked up reads the same as a dose not
taken. Whoever builds outbound decides how the clinician is told.

### Exotel, as wired

`voice/exotel.py` is the adapter. Three of Exotel's choices decided its
shape, and all three are in its own documentation:

- The Passthru applet makes a **GET** with query parameters, not a JSON
  POST, so the adapter is a separate route from `/api/voice/inbound`.
- Exotel documents no custom HTTP headers, so the shared secret travels
  in the URL path. That is weaker than `X-Gateway-Key`, because a URL is
  logged by the provider and by anything in between. Rotate it, and
  prefer the header route for any provider that supports one. A wrong
  secret gets 404 rather than 401, so an unguessed URL does not confirm
  it exists.
- A Passthru response "cannot be customised" and carries only a binary
  decision: 200 one path through the flow, 302 the other. So this
  endpoint cannot tell Exotel what to say. The prompts, the menu and the
  keypad gathering all live in Exotel's flow builder; 200 means stored
  and 302 means not, and the flow plays its own recorded prompt either
  way.

That last point is why the branch is in the URL and not in the payload.
Exotel hands over only the digits from the gather immediately before, so
asking "which medicine" at one step and "taken or not" at another would
need the endpoint to remember a half-finished call. It does not. The flow
branches first and the branch is part of the address it calls, so nothing
is held between requests and a restart loses nothing.

The URLs to paste into the flow builder, with the secret from
`HEALTHATHON_VOICE_GATEWAY_KEY` in `api/.env`:

```
https://<public-host>/api/voice/exotel/<secret>/tick/yes
https://<public-host>/api/voice/exotel/<secret>/tick/no
https://<public-host>/api/voice/exotel/<secret>/reading/fasting
https://<public-host>/api/voice/exotel/<secret>/reading/before_meal
https://<public-host>/api/voice/exotel/<secret>/reading/after_meal
https://<public-host>/api/voice/exotel/<secret>/reading/bedtime
https://<public-host>/api/voice/exotel/<secret>/reading/random
```

`digits` arrives wrapped in double quotes, which Exotel's documentation
says to trim, and the adapter does. Exotel's `CallSid` plus which branch
and which digits make the capture id, so a redelivered Passthru stores
once while two instructions in one call both store.

A spoken answer is **not** wired to Exotel. Their Voicemail applet hands
back a `RecordingUrl` to fetch and store, which nothing here does yet.
The generic endpoint takes a spoken answer through `audio_key`.

### What a different provider's adapter has to do



`VoiceStep` is deliberately not Twilio's shape or Exotel's. An adapter
maps the provider's form fields onto it, so nothing in the record depends
on which company carries the call:

| VoiceStep field | What the adapter supplies |
| --- | --- |
| `call_id`, `step` | the provider's call id, and which step this is. Together they are the capture id, so a redelivered webhook stores once |
| `from` | caller ID |
| `kind` | `menu`, `tick`, `reading` or `answer`, from which prompt was playing |
| `digits` | the keys pressed, with `#` and `*` stripped |
| `item_number` | which medicine, by its number on the SMS card, carried from the earlier step |
| `context` | which key the caller pressed for the time of day |
| `audio_key` | for a spoken answer, the recording already stored |

The reply names a recorded prompt and repeats the digits stored. It
carries no text to speak, so no machine voice is needed and no recording
has to pronounce a drug name: a medicine is its number on the card.

### Open before building



- **Provider.** Twilio already sends the sign-in codes, but calls from a +91
  caller ID to +91 numbers reportedly stopped working in August 2024. Confirm
  that on its India voice guidelines. Exotel documents keypad menus that post
  to a server. Neither has been tried, and the TRAI rules for this kind of
  number have not been checked.
- **Prompts.** Hindi and Urdu need recording by people, and those strings are
  still unreviewed drafts.
- **Who is calling.** Caller ID identifies the phone, not the person, the same
  weakness SMS has. `core.caregiver.phone_hmac` exists but the SMS path does
  not read it, so decide whether a caregiver can answer by phone.
- **Consent wording.** A provider carries the call, so the `voice` consent has
  to say so.

## Next steps

**Track A (Abbas)**

1. Seed script, replacing `api/dev_seed`, with the same four registration numbers.
2. Answer schema questions 1, 5 and 7. Question 1 now blocks two things:
   drug names reaching the queue, and regions the agent declined to read.
3. `pat.compliance_score` migration and the guardrail change, then store the
   score the visit endpoint computes.
4. Measure the reader against a gold set. Nothing yet says how often the
   agent is right, only that what it returns is traceable.

**Track B (Saadat)**

1. Get the Hindi and Urdu strings reviewed by speakers.
2. Run the patient app on an Android phone.
3. `/impeccable audit` the upload screen now that it runs on the real
   pipeline: a real read takes seconds, not the mock's fixed 3.
