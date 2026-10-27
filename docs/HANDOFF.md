# Handoff: state of the build and what comes next

Last updated 26 October 2026, at the end of Track B's UI pass (branch
`dev/saadat`). Written for Abbas and for any agent working on Track A. Read
`AGENTS.md` first; everything here sits under its rules.

## In one paragraph

Every interface surface in the scope now exists: the clinician web app
(`apps/clinic`) and the patient Android app (`apps/patient`, Expo). Three
clinician screens run on real endpoints (`api/`). Everything else runs
against **typed mocks**, which act as the spec for the endpoints Track A still
has to build. Building an endpoint means implementing the contract the mock
already obeys, then deleting the mock. Nothing in the UI should need to change.

## What is real and what is mocked

| Surface | Path | Data |
| --- | --- | --- |
| Confirm queue | `apps/clinic/src/confirm-queue` | Real: `GET /api/confirm-queue`, `POST /api/confirm-queue/{id}/decision` |
| Patient list, Documents tab, trace view | `apps/clinic/src/record`, `src/trace` | Real: `GET /api/patients`, `/api/patients/{id}/record`, `/api/values/{id}/trace` |
| Checklist and prescription review | `apps/clinic/src/checklist` | Mock |
| Timeline | `apps/clinic/src/timeline` | Document values real, patient entries mock |
| Visit page and compliance score | `apps/clinic/src/visit` | Document values real, the rest mock |
| Paper form | `apps/clinic/src/paperform` | Mock |
| Upload | `apps/clinic/src/upload` | Mock (stands in for the reading pipeline) |
| Patient app | `apps/patient` | Mock (in-app, `src/data/mockApi.ts`) |

The real seed is a stand-in too: `api/dev_seed` writes four fictional
patients with generated lab report pages. Track A's seed script should
replace it, keeping the same four registration numbers (DEV-0001 to
DEV-0004), because the mocks key their data to them.

## Endpoints to build

Each line gives the contract type and the mock that defines its behaviour.
The mock's tests are the acceptance tests: port them to `api/tests` when the
endpoint lands.

### Clinician app (contracts in `apps/clinic/src/api/pending.ts`)

| Endpoint | Contract | Mock and its tests | Rules the mock enforces |
| --- | --- | --- | --- |
| `GET /api/patients/{id}/checklist` | `Checklist` | `src/mocks/handlers/checklist.ts` | Active regimen plus regimens awaiting review |
| `GET /api/regimens/{id}/review` | `RegimenReview` | same | Says what activation would replace |
| `POST /api/regimen-items/{id}/confirm` | `ItemDecision` -> `RegimenItem` | same | `decision_latency_ms` required; optional corrected text, trimmed, never empty; 409 once active |
| `DELETE /api/regimen-items/{id}` | | same | Line is not a medicine; 409 once active |
| `POST /api/regimens/{id}/activate` | `{ activated_at }` | same | 409 unless every item confirmed and at least one item; supersedes the previous active regimen |
| `GET /api/patients/{id}/entries?from&to` | `EntriesPage` | `entries.ts` | Patient entries in range, plus every regimen item active in it, so gaps show |
| `GET /api/patients/{id}/visit` | `VisitSummary` | `visit.ts` | Period since last visit, test orders with or without a matched report, the compliance score with its day array |
| `GET /api/paper-form/questions`, `POST /api/patients/{id}/paper-form` | `PaperFormSubmission` -> `PaperFormResult` | `paperForm.ts` | Idempotent by `client_capture_id`; 409 for a tick already recorded; every reading needs a numeric value and a context; no range applied |
| `POST /api/uploads`, `GET /api/uploads/{id}` | `UploadRequest` -> `UploadStatus` | `upload.ts` | Idempotent by capture id; duplicate by `(patient, sha256)` only after a successful read; a prescription produces a regimen awaiting review |

### Patient app (contract in `apps/patient/src/data/types.ts`)

`PatientApi`: `patients`, `today`, `setTick`, `addReading`, `answer`,
`addMeal`, `surveyQuestions`, `submitSurvey`. The mock and its tests are
`src/data/mockApi.ts` and `mockApi.test.ts`. Every write carries a capture id
and is idempotent. A reading is stored only with its context. An HTTP client
implementing `PatientApi` replaces the mock in `src/AppState.tsx` (the
`api` prop). No screen changes.

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
   exception (week 3 in the work split). The UI expects the stored counts plus
   the full day array, and refuses to show a score that disagrees with a
   recount of its days (`apps/clinic/src/visit/score.ts`).
5. **Regimen item corrections.** The mock overwrites the item's text when a
   reviewer corrects it. The audit log should keep the original reading.
   Decide whether `regimen_item` needs a supersede chain like
   `extracted_value`.
6. **Test orders.** `core.test_order` exists; nothing writes it yet. The visit
   page shows "No matching report in this record" for unmatched orders.

## Not finished

- **Hindi and Urdu strings are drafts.** `apps/patient/src/i18n/hi.ts` and
  `ur.ts` are marked `REVIEWED = false`, and a test keeps them that way until
  a speaker reviews every string. Do not use them at the demonstration
  before then. The clinician app is English only.
- **A tick cannot yet be recorded as "not taken" in the patient app.** Tapping
  toggles between ticked and no entry. The schema allows `ticked = false`, and
  the paper form uses it.
- **Meal photos** are stored as a local URI in the mock. Real storage needs
  the same rules as document images: never committed, never leaving the
  clinic boundary.
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
2. Answer the schema questions above, then the regimen endpoints (review,
   confirm, activate), since the patient checklist depends on them.
3. Patient entries and the patient app's write endpoints.
4. `pat.compliance_score` migration and the guardrail change.
5. The reading pipeline behind `POST /api/uploads`.

**Track B (Saadat)**

1. Wire each screen as its endpoint lands (steps above).
2. Get the Hindi and Urdu strings reviewed by speakers.
3. Run the patient app on an Android phone; add a "not taken" tick if wanted.
4. SMS endpoint, if the cut list allows.
5. `/impeccable critique` and `/impeccable audit` again after wiring.
