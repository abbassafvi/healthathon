-- =====================================================================
--  Consultation Readiness and Continuous Follow-up in Diabetes Care
--  PostgreSQL schema
--
--  Five rules this schema is built to enforce, not merely document:
--
--  R1  Truth lives in extracted_value + provenance. Everything the doctor
--      sees is a projection that can be dropped and rebuilt.
--  R2  No clinical value exists without provenance. The FK is NOT NULL,
--      so an unsourced value cannot be inserted at all.
--  R3  No column may hold a judgement. There is no severity, flag,
--      abnormal, score, risk, priority, trend or reference_range column
--      anywhere. See the migration lint at the end of this file.
--  R4  Values are immutable. A correction is a new row that supersedes
--      the old one. Nothing is ever UPDATEd in place.
--  R5  Patient-reported data and document-verified data live in separate
--      tables with no view that merges them.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;      -- gen_random_uuid(), digest()
CREATE EXTENSION IF NOT EXISTS pg_trgm;       -- fuzzy lookup on lab names only
CREATE EXTENSION IF NOT EXISTS citext;        -- case-insensitive email

CREATE SCHEMA IF NOT EXISTS core;    -- identity, documents, values, provenance
CREATE SCHEMA IF NOT EXISTS pat;     -- patient-reported, kept deliberately apart
CREATE SCHEMA IF NOT EXISTS proj;    -- rebuildable projections
CREATE SCHEMA IF NOT EXISTS audit;   -- append-only
CREATE SCHEMA IF NOT EXISTS eval;    -- gold set and measurement

-- =====================================================================
--  0 · ENUMERATED VOCABULARIES
--  Closed sets. A reader cannot invent a member of any of these.
-- =====================================================================

CREATE TYPE core.doc_type AS ENUM (
    'lab_report', 'prescription', 'discharge_summary',
    'imaging_report', 'referral_letter', 'register_sheet', 'other');

CREATE TYPE core.intake_channel AS ENUM (
    'desk_scan', 'patient_app', 'whatsapp_forward', 'email_drop',
    'sms', 'voice_call', 'paper_form', 'spreadsheet_import', 'emr_export');

CREATE TYPE core.provenance_kind AS ENUM (
    'source_document',          -- we hold the image and can point at a region
    'register_transcription',   -- a human transcribed from an original we do not hold
    'clinician_entered',        -- typed by a named clinician
    'patient_reported');        -- never mixed with the three above

CREATE TYPE core.value_state AS ENUM (
    'pending_check',   -- extracted, checks not finished
    'accepted',        -- grounded, renderable
    'needs_confirm',   -- ungrounded, sits in the confirm queue, NEVER rendered
    'confirmed',       -- a human confirmed it
    'superseded',      -- replaced by a newer row
    'discarded');      -- a human marked it not a clinical value

CREATE TYPE core.check_code AS ENUM (
    'grounding',        -- is there a usable region on the page?
    'reread_agreement', -- do two independent readers agree?
    'cross_document',   -- does the same analyte elsewhere agree?
    'well_formed',      -- unit known, value inside the assay range, date real
    'legibility');      -- was that region of the image sharp enough?

CREATE TYPE core.check_outcome AS ENUM ('pass', 'fail', 'not_applicable');

CREATE TYPE core.user_role AS ENUM ('clinician', 'transcription_verifier', 'admin');

CREATE TYPE core.entered_by AS ENUM ('patient', 'caregiver', 'clinic_staff');

-- Mandatory on every glucose reading. A bare number cannot be stored.
CREATE TYPE pat.glucose_context AS ENUM (
    'fasting', 'before_meal', 'after_meal', 'bedtime', 'overnight', 'random');

-- The meal a photograph is of, as the patient chose it.
CREATE TYPE pat.meal AS ENUM ('breakfast', 'lunch', 'dinner', 'snack');

CREATE TYPE pat.entry_kind AS ENUM (
    'glucose_reading', 'medication_tick', 'felt_low_entry',
    'meal_photo', 'survey_answer', 'free_symptom_note', 'wearable_summary');

CREATE TYPE core.confirm_reason AS ENUM (
    'no_region_on_page', 'readers_disagree', 'conflicting_documents',
    'unknown_unit', 'outside_assay_range', 'implausible_date',
    'region_illegible', 'handwritten', 'script_not_read');

-- =====================================================================
--  1 · REFERENCE VOCABULARY
--  Authored with the clinical lead. Signed, versioned, and auditable.
-- =====================================================================

CREATE TABLE core.analyte (
    code              text PRIMARY KEY,                 -- e.g. 'hba1c'
    display_name      text        NOT NULL,
    loinc_code        text,
    canonical_unit    text        NOT NULL,
    decimal_places    smallint    NOT NULL DEFAULT 1,
    created_at        timestamptz NOT NULL DEFAULT now()
);
COMMENT ON TABLE core.analyte IS
  'Closed set of ~25 diabetes-relevant tests. The analyte of an extracted '
  'value is a FK to this table, never free text, so a reader cannot invent one.';

CREATE TABLE core.analyte_alias (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    analyte_code  text NOT NULL REFERENCES core.analyte(code) ON DELETE RESTRICT,
    alias         text NOT NULL,                        -- as printed by some lab
    UNIQUE (analyte_code, alias)
);

CREATE TABLE core.unit_conversion (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    analyte_code   text    NOT NULL REFERENCES core.analyte(code),
    from_unit      text    NOT NULL,
    to_unit        text    NOT NULL,
    factor         numeric NOT NULL,
    offset_term    numeric NOT NULL DEFAULT 0,
    signed_off_by  uuid    NOT NULL,                    -- core.clinic_user
    signed_off_at  timestamptz NOT NULL,
    UNIQUE (analyte_code, from_unit, to_unit)
);
COMMENT ON TABLE core.unit_conversion IS
  'Unit canonicalisation is the ONLY arithmetic the system performs on a '
  'clinical value, and the as-printed value and unit always remain the '
  'primary display string.';

CREATE TABLE core.analyte_reportable_range (
    analyte_code   text PRIMARY KEY REFERENCES core.analyte(code),
    min_reportable numeric NOT NULL,
    max_reportable numeric NOT NULL,
    source         text    NOT NULL,                    -- assay documentation
    signed_off_by  uuid    NOT NULL,
    signed_off_at  timestamptz NOT NULL,
    CHECK (min_reportable < max_reportable)
);
COMMENT ON TABLE core.analyte_reportable_range IS
  'THE ANALYTICAL RANGE OF THE ASSAY, i.e. what a machine could physically '
  'have printed. This is NOT a clinical reference range and NOT a threshold. '
  'It is deliberately far wider than any clinical interval, it is never '
  'rendered to any user, and its only permitted effect is to route a value '
  'to a human for confirmation. Rendering it anywhere is a defect.';

-- =====================================================================
--  2 · IDENTITY, ROLES AND CONSENT
-- =====================================================================

CREATE TABLE core.clinic_user (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name     text        NOT NULL,
    role          core.user_role NOT NULL,
    email         citext,
    is_active     boolean     NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE core.patient (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    registration_no    text UNIQUE NOT NULL,            -- the clinic's own number
    full_name          text        NOT NULL,
    year_of_birth      smallint,
    sex                text,
    preferred_language text        NOT NULL DEFAULT 'en',  -- BCP-47
    enrolled_at        timestamptz NOT NULL DEFAULT now(),
    exited_at          timestamptz,
    CHECK (year_of_birth IS NULL OR year_of_birth BETWEEN 1900 AND 2100)
);

-- Phone numbers are matched by HMAC so an inbound SMS can be bound to a
-- patient without storing a plaintext searchable index of numbers.
CREATE TABLE core.patient_phone (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id   uuid NOT NULL REFERENCES core.patient(id) ON DELETE CASCADE,
    phone_hmac   bytea NOT NULL,
    phone_last4  char(4) NOT NULL,
    is_primary   boolean NOT NULL DEFAULT false,
    UNIQUE (phone_hmac)
);

CREATE TABLE core.caregiver (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id    uuid NOT NULL REFERENCES core.patient(id) ON DELETE CASCADE,
    full_name     text NOT NULL,
    relationship  text,
    phone_hmac    bytea,
    nominated_at  timestamptz NOT NULL DEFAULT now(),
    revoked_at    timestamptz
);
COMMENT ON TABLE core.caregiver IS
  'A nominated caregiver may answer on the patient''s behalf. Every entry '
  'records who made it, so a tick entered by a family member is never '
  'presented as the patient''s own.';

CREATE TABLE core.consent (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id     uuid NOT NULL REFERENCES core.patient(id) ON DELETE CASCADE,
    item           text NOT NULL,       -- 'enrolment', 'caregiver', 'sms', 'voice'
    granted        boolean NOT NULL,
    language       text    NOT NULL,
    captured_by    uuid    NOT NULL REFERENCES core.clinic_user(id),
    captured_at    timestamptz NOT NULL DEFAULT now(),
    withdrawn_at   timestamptz
);
COMMENT ON TABLE core.consent IS
  'Itemised and separately refusable, per the DPDP Act 2023. Processing for '
  'an item with no granted, unwithdrawn row must fail closed.';

-- =====================================================================
--  3 · INTAKE AND DOCUMENTS
-- =====================================================================

-- One row per capture event. client_capture_id is generated on the device at
-- the moment of capture and is the idempotency key end to end, so a retry, a
-- duplicate tap or a phone that reboots mid-upload cannot duplicate a record.
CREATE TABLE core.intake (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_capture_id text        NOT NULL UNIQUE,
    channel           core.intake_channel NOT NULL,
    patient_id        uuid        REFERENCES core.patient(id),
    captured_at       timestamptz NOT NULL,   -- device clock: clinical ordering
    received_at       timestamptz NOT NULL DEFAULT now(),  -- server: audit order
    uploaded_by       uuid        REFERENCES core.clinic_user(id),
    unmatched_reason  text                    -- set when patient_id is NULL
);
CREATE INDEX intake_unmatched_idx ON core.intake (received_at)
    WHERE patient_id IS NULL;

CREATE TABLE core.document (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    intake_id      uuid NOT NULL REFERENCES core.intake(id) ON DELETE RESTRICT,
    patient_id     uuid NOT NULL REFERENCES core.patient(id),
    doc_type       core.doc_type NOT NULL,
    issuing_source text,                       -- laboratory or hospital as printed
    document_date  date,                       -- the date printed on the document
    sha256         bytea NOT NULL,
    storage_key    text  NOT NULL,
    page_count     smallint NOT NULL CHECK (page_count > 0),
    has_text_layer boolean  NOT NULL DEFAULT false,  -- native PDF, skips recognition
    created_at     timestamptz NOT NULL DEFAULT now(),
    UNIQUE (patient_id, sha256)                 -- re-forwarded copies dedupe free
);

CREATE TABLE core.document_page (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id   uuid NOT NULL REFERENCES core.document(id) ON DELETE CASCADE,
    page_no       smallint NOT NULL CHECK (page_no > 0),
    storage_key   text NOT NULL,
    width_px      integer NOT NULL,
    height_px     integer NOT NULL,
    -- Image quality, computed once at normalisation and reused by the
    -- legibility check. These describe the PHOTOGRAPH, never the patient.
    sharpness     numeric,
    contrast      numeric,
    skew_deg      numeric,
    UNIQUE (document_id, page_no)
);

-- =====================================================================
--  4 · EXTRACTION, PROVENANCE AND VERIFICATION
--  This is the core of the project.
-- =====================================================================

CREATE TABLE core.extraction_run (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id     uuid NOT NULL REFERENCES core.document(id) ON DELETE CASCADE,
    reader_name     text NOT NULL,            -- e.g. 'paddleocr-ppstructure'
    reader_version  text NOT NULL,
    profile_version text NOT NULL,            -- extraction profile for this layout
    code_commit     text NOT NULL,
    prompt_sha256   bytea,                    -- NULL for non-generative readers
    started_at      timestamptz NOT NULL DEFAULT now(),
    finished_at     timestamptz,
    raw_output      jsonb                     -- kept for reproducibility
);
COMMENT ON TABLE core.extraction_run IS
  'Every extracted value points at the exact run that produced it, so any '
  'number on screen can be reproduced from the model id, the profile and '
  'the commit.';

-- Provenance is its own table because R2 makes the reference NOT NULL on
-- extracted_value. There is no way to write a clinical value without one.
CREATE TABLE core.provenance (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    kind          core.provenance_kind NOT NULL,
    document_id   uuid REFERENCES core.document(id),
    page_id       uuid REFERENCES core.document_page(id),
    -- Normalised region on the page, 0..1. This is "point to it".
    bbox_x        numeric CHECK (bbox_x BETWEEN 0 AND 1),
    bbox_y        numeric CHECK (bbox_y BETWEEN 0 AND 1),
    bbox_w        numeric CHECK (bbox_w > 0 AND bbox_w <= 1),
    bbox_h        numeric CHECK (bbox_h > 0 AND bbox_h <= 1),
    char_start    integer,                    -- native PDF text layer instead
    char_end      integer,
    crop_sha256   bytea,                      -- the crop a human was shown
    entered_by_id uuid REFERENCES core.clinic_user(id),
    created_at    timestamptz NOT NULL DEFAULT now(),
    -- A source_document provenance must actually point somewhere.
    CONSTRAINT prov_document_region_required CHECK (
        kind <> 'source_document' OR (
            document_id IS NOT NULL AND page_id IS NOT NULL AND (
                bbox_x IS NOT NULL OR char_start IS NOT NULL)))
    ,
    CONSTRAINT prov_clinician_entered_has_actor CHECK (
        kind <> 'clinician_entered' OR entered_by_id IS NOT NULL)
);

CREATE TABLE core.extracted_value (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id       uuid NOT NULL REFERENCES core.patient(id),
    document_id      uuid NOT NULL REFERENCES core.document(id),
    extraction_run_id uuid REFERENCES core.extraction_run(id),
    provenance_id    uuid NOT NULL REFERENCES core.provenance(id),   -- R2
    analyte_code     text NOT NULL REFERENCES core.analyte(code),    -- closed set

    -- As printed. This is always the primary display string.
    value_text       text    NOT NULL,
    unit_text        text,
    -- Canonicalised, for cross-document comparison only.
    value_canonical  numeric,
    unit_canonical   text,
    conversion_id    uuid REFERENCES core.unit_conversion(id),

    observed_at      date,          -- the date on the report, not ingestion date
    state            core.value_state NOT NULL DEFAULT 'pending_check',
    superseded_by    uuid REFERENCES core.extracted_value(id),       -- R4
    created_at       timestamptz NOT NULL DEFAULT now(),

    CONSTRAINT value_superseded_consistently CHECK (
        (state = 'superseded') = (superseded_by IS NOT NULL)),
    CONSTRAINT value_canonical_needs_conversion CHECK (
        value_canonical IS NULL OR unit_canonical IS NOT NULL)
);

COMMENT ON COLUMN core.extracted_value.value_text IS
  'The string exactly as printed on the page. Rendering code must show this, '
  'not value_canonical, which exists only so two documents can be compared.';

CREATE INDEX ev_patient_analyte_idx
    ON core.extracted_value (patient_id, analyte_code, observed_at DESC);
-- Only accepted and confirmed values are ever renderable.
CREATE INDEX ev_renderable_idx
    ON core.extracted_value (patient_id, observed_at DESC)
    WHERE state IN ('accepted', 'confirmed');

-- A check belongs to exactly one subject: a laboratory value, or a line
-- of a prescription. Both are read the same way and both are settled by
-- the same five checks, so they share this table rather than diverging.
CREATE TABLE core.check_result (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    extracted_value_id uuid REFERENCES core.extracted_value(id)
                            ON DELETE CASCADE,
    -- The foreign keys are added after their tables exist, below.
    regimen_item_id    uuid,
    regimen_advice_id  uuid,
    check_code         core.check_code   NOT NULL,
    outcome            core.check_outcome NOT NULL,
    signal             numeric,            -- agreement score, sharpness, etc.
    detail             jsonb,
    checked_at         timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT check_result_one_subject CHECK (
        (extracted_value_id IS NOT NULL)::int
        + (regimen_item_id IS NOT NULL)::int
        + (regimen_advice_id IS NOT NULL)::int = 1),
    UNIQUE (extracted_value_id, check_code),
    UNIQUE (regimen_item_id, check_code),
    UNIQUE (regimen_advice_id, check_code)
);
COMMENT ON TABLE core.check_result IS
  'The five checks are stored separately rather than collapsed into one '
  'confidence number, so per-check ablations can be measured and so a '
  'confirm-queue reason can name which check failed.';

-- A value that two documents disagree about: both are kept, neither is preferred.
CREATE TABLE core.value_conflict (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    value_a_id uuid NOT NULL REFERENCES core.extracted_value(id),
    value_b_id uuid NOT NULL REFERENCES core.extracted_value(id),
    noted_at   timestamptz NOT NULL DEFAULT now(),
    CHECK (value_a_id <> value_b_id)
);

-- =====================================================================
--  5 · THE HUMAN IN THE LOOP
-- =====================================================================

CREATE TABLE core.confirm_queue_item (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    extracted_value_id uuid NOT NULL UNIQUE
                            REFERENCES core.extracted_value(id) ON DELETE CASCADE,
    reason             core.confirm_reason NOT NULL,
    crop_storage_key   text NOT NULL,         -- rendered before the control enables
    candidate_readings jsonb,                 -- one-tap options offered
    created_at         timestamptz NOT NULL DEFAULT now(),
    resolved_at        timestamptz,
    resolved_by        uuid REFERENCES core.clinic_user(id)
);
-- Ordered by arrival, never by clinical importance.
CREATE INDEX cq_open_idx ON core.confirm_queue_item (created_at)
    WHERE resolved_at IS NULL;

CREATE TABLE core.value_correction (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    original_value_id  uuid NOT NULL REFERENCES core.extracted_value(id),
    replacement_value_id uuid REFERENCES core.extracted_value(id),
    actor_id           uuid NOT NULL REFERENCES core.clinic_user(id),
    reason_code        text NOT NULL,
    crop_sha256        bytea,                 -- the exact crop the human saw
    decision_latency_ms integer,              -- instrument for complacency
    corrected_at       timestamptz NOT NULL DEFAULT now()
);
COMMENT ON COLUMN core.value_correction.decision_latency_ms IS
  'Time from the crop rendering to the decision. Measured so that automation '
  'complacency, where a reviewer stops actually looking, is observable.';

-- =====================================================================
--  6 · PATIENT-REPORTED DATA  (separate schema, R5)
-- =====================================================================

CREATE TABLE pat.entry (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id        uuid NOT NULL REFERENCES core.patient(id) ON DELETE CASCADE,
    kind              pat.entry_kind NOT NULL,
    channel           core.intake_channel NOT NULL,
    entered_by        core.entered_by NOT NULL,
    caregiver_id      uuid REFERENCES core.caregiver(id),
    language          text NOT NULL,
    client_capture_id text UNIQUE,            -- offline idempotency
    occurred_at       timestamptz NOT NULL,   -- when it happened, per the patient
    recorded_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT caregiver_present_when_claimed CHECK (
        (entered_by = 'caregiver') = (caregiver_id IS NOT NULL))
);
COMMENT ON TABLE pat.entry IS
  'Patient-reported data lives in its own schema. There is no view that '
  'joins it to core.extracted_value, and the cross_document check never '
  'uses a patient entry to corroborate a document value.';

CREATE TABLE pat.glucose_reading (
    entry_id     uuid PRIMARY KEY REFERENCES pat.entry(id) ON DELETE CASCADE,
    value_text   text    NOT NULL,            -- as the patient entered it
    value_mgdl   numeric,
    context      pat.glucose_context NOT NULL,   -- mandatory, no bare numbers
    insulin_units numeric,
    meter_photo_key text
);
COMMENT ON COLUMN pat.glucose_reading.context IS
  'NOT NULL by design. A reading of 180 before breakfast and 180 after lunch '
  'are different data points, and a bare number cannot be stored.';

CREATE TABLE pat.medication_tick (
    entry_id        uuid PRIMARY KEY REFERENCES pat.entry(id) ON DELETE CASCADE,
    regimen_item_id uuid NOT NULL,
    tick_date       date NOT NULL,
    ticked          boolean NOT NULL
);
COMMENT ON TABLE pat.medication_tick IS
  'A tick is what the patient recorded. It is not proof a dose was taken, '
  'and the word adherence appears nowhere in this schema.';

CREATE TABLE pat.felt_low_entry (
    entry_id          uuid PRIMARY KEY REFERENCES pat.entry(id) ON DELETE CASCADE,
    someone_helped_me boolean,
    question_set_version text NOT NULL
);
COMMENT ON TABLE pat.felt_low_entry IS
  'Named for the button the patient pressed, not for a clinical category. '
  'There is deliberately no severity column: "required third-party '
  'assistance" is a grading criterion in diabetology and this is not that.';

CREATE TABLE pat.meal_photo (
    entry_id      uuid PRIMARY KEY REFERENCES pat.entry(id) ON DELETE CASCADE,
    storage_key   text NOT NULL,
    taken_at      timestamptz NOT NULL,   -- when the photograph was taken
    meal          pat.meal,               -- NULL only for photographs sent before it was asked
    calories_text text CHECK (calories_text ~ '^[0-9]{1,4}$')
    -- calories_text is only ever what the patient typed because they knew it,
    -- stored as typed. Nothing is estimated from the photograph, nothing is
    -- added up, and no photograph leaves the clinic boundary. There is no
    -- portion or macronutrient column.
);

CREATE TABLE pat.wearable_summary (
    entry_id    uuid PRIMARY KEY REFERENCES pat.entry(id) ON DELETE CASCADE,
    source      text NOT NULL,
    metric      text NOT NULL,     -- 'steps', 'resting_hr', 'sleep_minutes'
    value_text  text NOT NULL,
    period_start timestamptz NOT NULL,
    period_end   timestamptz NOT NULL
);

-- ---------------------------------------------------------------------
--  Questions: authored by clinicians, versioned, never generated
-- ---------------------------------------------------------------------

CREATE TABLE pat.question_bank_item (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    question_key  text NOT NULL,
    version       integer NOT NULL,
    approved_by   uuid NOT NULL REFERENCES core.clinic_user(id),
    approved_at   timestamptz NOT NULL,
    display_order integer NOT NULL,           -- fixed, clinician-authored order
    UNIQUE (question_key, version)
);
COMMENT ON TABLE pat.question_bank_item IS
  'The bank is authored and version-signed by clinicians. The system stores, '
  'translates and presents questions. It does not write them, suggest them, '
  'reorder them by usage, or decide what is clinically relevant.';

CREATE TABLE pat.question_text (
    question_id uuid NOT NULL REFERENCES pat.question_bank_item(id)
                     ON DELETE CASCADE,
    language    text NOT NULL,
    text        text NOT NULL,
    audio_key   text,                          -- pre-rendered, free and offline
    PRIMARY KEY (question_id, language)
);

CREATE TABLE pat.patient_question_set (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id   uuid NOT NULL REFERENCES core.patient(id) ON DELETE CASCADE,
    chosen_by    uuid NOT NULL REFERENCES core.clinic_user(id),
    chosen_at    timestamptz NOT NULL DEFAULT now(),
    active_until timestamptz
);

CREATE TABLE pat.patient_question_set_item (
    set_id      uuid NOT NULL REFERENCES pat.patient_question_set(id)
                     ON DELETE CASCADE,
    question_id uuid NOT NULL REFERENCES pat.question_bank_item(id),
    PRIMARY KEY (set_id, question_id)
);

CREATE TABLE pat.survey_answer (
    entry_id    uuid PRIMARY KEY REFERENCES pat.entry(id) ON DELETE CASCADE,
    question_id uuid NOT NULL REFERENCES pat.question_bank_item(id),
    answer_text text,                          -- stored exactly as given
    audio_key   text,                          -- the patient's own recording, as recorded
    set_id      uuid REFERENCES pat.patient_question_set(id),
    CONSTRAINT answer_given CHECK (answer_text IS NOT NULL OR audio_key IS NOT NULL)
    -- No score, no weight, no total. Answers are never added up. A spoken
    -- answer is kept as a recording and not transcribed.
);

-- =====================================================================
--  7 · MEDICATION REGIMEN
--  Built from a prescription, activated by a clinician. The strictest gate
--  in the system: a wrong checklist handed to a patient is worse than none.
-- =====================================================================

CREATE TABLE core.regimen (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id     uuid NOT NULL REFERENCES core.patient(id) ON DELETE CASCADE,
    source_document_id uuid REFERENCES core.document(id),
    activated_by   uuid REFERENCES core.clinic_user(id),
    activated_at   timestamptz,
    superseded_at  timestamptz
);

CREATE TABLE core.regimen_item (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    regimen_id    uuid NOT NULL REFERENCES core.regimen(id) ON DELETE CASCADE,
    drug_text     text NOT NULL,              -- the brand name as printed
    dose_text     text NOT NULL,              -- the dose as printed
    schedule_text text,
    provenance_id uuid NOT NULL REFERENCES core.provenance(id),
    confirmed_by  uuid REFERENCES core.clinic_user(id),
    confirmed_at  timestamptz,
    -- Set when every check this line ran passed. Kept apart from
    -- confirmed_by so the record never says a person looked at a line
    -- the deterministic layer settled on its own.
    accepted_at   timestamptz,
    CONSTRAINT item_confirmed_by_a_person CHECK (
        (confirmed_at IS NULL) = (confirmed_by IS NULL))
);
COMMENT ON TABLE core.regimen_item IS
  'A line reaches a patient checklist when the regimen is activated, and '
  'activation requires every line to have been settled: either accepted by '
  'the five checks (accepted_at) or confirmed by a named clinician '
  '(confirmed_by). The two are separate columns because the audit must '
  'never attribute to a person a line nobody looked at. Brand-to-generic '
  'mapping is deliberately absent: a generic name is not printed on the '
  'prescription, so it would be the one displayed string with no crop to '
  'check it against.';

-- What the prescription asks of the patient besides a medicine: a diet,
-- a walk, a measurement to bring. Its own table, not a kind column on
-- regimen_item, because pat.medication_tick points at that table and
-- the compliance score is computed from medication ticks alone. A walk
-- counted as a dose would corrupt the one clinical number this project
-- allows itself, and one forgotten filter is all it would take.
CREATE TABLE core.regimen_advice (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    regimen_id    uuid NOT NULL REFERENCES core.regimen(id) ON DELETE CASCADE,
    advice_text   text NOT NULL,              -- as written, never summarised
    provenance_id uuid NOT NULL REFERENCES core.provenance(id),
    confirmed_by  uuid REFERENCES core.clinic_user(id),
    confirmed_at  timestamptz,
    accepted_at   timestamptz,
    CONSTRAINT advice_confirmed_by_a_person CHECK (
        (confirmed_at IS NULL) = (confirmed_by IS NULL))
);
COMMENT ON TABLE core.regimen_advice IS
  'Instructions a prescription gives that are not medicines, held apart '
  'from core.regimen_item so that pat.medication_tick, and therefore the '
  'compliance score, can only ever count medicines. Stored as written: '
  'no calorie total is computed and no advice is rephrased.';

ALTER TABLE pat.medication_tick
    ADD CONSTRAINT tick_regimen_item_fk
    FOREIGN KEY (regimen_item_id) REFERENCES core.regimen_item(id);

-- Declared with core.check_result, which is created before this table.
ALTER TABLE core.check_result
    ADD CONSTRAINT check_result_regimen_item_fk
    FOREIGN KEY (regimen_item_id) REFERENCES core.regimen_item(id) ON DELETE CASCADE;

ALTER TABLE core.check_result
    ADD CONSTRAINT check_result_regimen_advice_fk
    FOREIGN KEY (regimen_advice_id) REFERENCES core.regimen_advice(id) ON DELETE CASCADE;

-- =====================================================================
--  8 · ORDERS AND RECONCILIATION
--  Record completeness, which is clerical. Not a care-gap reminder.
-- =====================================================================

CREATE TABLE core.test_order (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id       uuid NOT NULL REFERENCES core.patient(id) ON DELETE CASCADE,
    analyte_code     text NOT NULL REFERENCES core.analyte(code),
    ordered_on       date NOT NULL,
    source_document_id uuid REFERENCES core.document(id),
    provenance_id    uuid NOT NULL REFERENCES core.provenance(id),
    matched_value_id uuid REFERENCES core.extracted_value(id),
    matched_at       timestamptz,
    closed_by        uuid REFERENCES core.clinic_user(id),
    closed_reason    text
);
COMMENT ON TABLE core.test_order IS
  'A set difference over this table yields orders with no matching report. '
  'The brief states that as a fact about the record ("no matching report in '
  'this record"), never as a statement about the patient ("test not done") '
  'and never as a due, overdue or recommended action.';

-- =====================================================================
--  9 · FORWARDING RULES
--  The doctor writes the rule. The platform forwards the reading and
--  nothing else. There is no column for a classification, a label or a
--  level, because a forwarded reading carries no words.
-- =====================================================================

CREATE TABLE core.forwarding_rule (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id    uuid NOT NULL REFERENCES core.patient(id) ON DELETE CASCADE,
    written_by    uuid NOT NULL REFERENCES core.clinic_user(id),
    analyte_code  text REFERENCES core.analyte(code),
    entry_kind    pat.entry_kind,
    comparator    text NOT NULL CHECK (comparator IN ('>', '>=', '<', '<=', '=')),
    threshold     numeric NOT NULL,
    glucose_context pat.glucose_context,
    written_at    timestamptz NOT NULL DEFAULT now(),
    active_from   timestamptz NOT NULL DEFAULT now(),
    active_until  timestamptz,
    CONSTRAINT rule_targets_one_thing CHECK (
        (analyte_code IS NOT NULL) <> (entry_kind IS NOT NULL))
);
COMMENT ON TABLE core.forwarding_rule IS
  'written_by is NOT NULL and references a clinician: the system cannot '
  'create a rule. The threshold is the doctor''s own instruction, held on '
  'their behalf. It is not a clinical reference range and is never applied '
  'to any patient other than the one named here.';

CREATE TABLE core.forwarded_reading (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    rule_id       uuid NOT NULL REFERENCES core.forwarding_rule(id),
    entry_id      uuid REFERENCES pat.entry(id),
    value_id      uuid REFERENCES core.extracted_value(id),
    recipient_id  uuid NOT NULL REFERENCES core.clinic_user(id),
    forwarded_at  timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT forward_has_one_source CHECK (
        (entry_id IS NOT NULL) <> (value_id IS NOT NULL))
);
COMMENT ON TABLE core.forwarded_reading IS
  'recipient_id references clinic_user, so a reading can only ever be '
  'forwarded to a member of the clinical team. There is no table and no '
  'code path that sends an interpretation to a patient.';

-- =====================================================================
--  10 · OUTBOUND MESSAGING  (operational only)
-- =====================================================================

CREATE TABLE core.message_log (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id   uuid REFERENCES core.patient(id) ON DELETE SET NULL,
    direction    text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    channel      core.intake_channel NOT NULL,
    template_key text,
    language     text,
    body_sha256  bytea,
    sent_at      timestamptz NOT NULL DEFAULT now(),
    delivered_at timestamptz,
    CONSTRAINT outbound_is_templated CHECK (
        direction = 'inbound' OR template_key IS NOT NULL)
);
COMMENT ON TABLE core.message_log IS
  'Outbound messages to patients must come from a fixed template, so free '
  'clinical text cannot be sent. Messages are on a fixed schedule and are '
  'never triggered by a gap or a value in that patient''s own data.';

-- =====================================================================
--  11 · PROJECTIONS  (rebuildable, R1)
-- =====================================================================

CREATE TABLE proj.visit (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id    uuid NOT NULL REFERENCES core.patient(id) ON DELETE CASCADE,
    scheduled_for timestamptz,
    started_at    timestamptz,
    clinician_id  uuid REFERENCES core.clinic_user(id)
);

CREATE TABLE proj.timeline_entry (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    patient_id         uuid NOT NULL REFERENCES core.patient(id) ON DELETE CASCADE,
    occurred_on        date NOT NULL,
    extracted_value_id uuid REFERENCES core.extracted_value(id) ON DELETE CASCADE,
    patient_entry_id   uuid REFERENCES pat.entry(id) ON DELETE CASCADE,
    test_order_id      uuid REFERENCES core.test_order(id) ON DELETE CASCADE,
    built_at           timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT timeline_points_at_exactly_one CHECK (
        (extracted_value_id IS NOT NULL)::int
      + (patient_entry_id   IS NOT NULL)::int
      + (test_order_id      IS NOT NULL)::int = 1)
);
-- Date order is the only order. There is no rank, priority or severity column
-- to sort by, so a severity-ordered view is not expressible.
CREATE INDEX timeline_date_idx
    ON proj.timeline_entry (patient_id, occurred_on DESC);

CREATE TABLE proj.visit_page_snapshot (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    visit_id    uuid NOT NULL REFERENCES proj.visit(id) ON DELETE CASCADE,
    rendered_at timestamptz NOT NULL DEFAULT now(),
    layout_version text NOT NULL,
    payload     jsonb NOT NULL,
    payload_sha256 bytea NOT NULL
);
COMMENT ON TABLE proj.visit_page_snapshot IS
  'The page has a fixed layout. Nothing is ranked, nothing is highlighted and '
  'nothing is left out. An order with no matching report renders as a blank '
  'space, not as a recommendation. The snapshot is hashed so the page a '
  'clinician actually saw can be reproduced exactly.';

-- =====================================================================
--  12 · AUDIT  (append-only, hash-chained)
-- =====================================================================

CREATE TABLE audit.event (
    id           bigserial PRIMARY KEY,
    occurred_at  timestamptz NOT NULL DEFAULT now(),
    actor_id     uuid REFERENCES core.clinic_user(id),
    actor_role   core.user_role,
    action       text NOT NULL,        -- 'value.confirm', 'record.read', ...
    entity_table text NOT NULL,
    entity_id    uuid,
    old_value    jsonb,
    new_value    jsonb,
    reason_code  text,
    device       text,
    app_version  text,
    prev_hash    bytea,
    this_hash    bytea NOT NULL
);
COMMENT ON TABLE audit.event IS
  'Append-only and tamper evident. this_hash = sha256(prev_hash || row). '
  'Grants are INSERT and SELECT only, with no UPDATE or DELETE to any role, '
  'and a startup self-check walks the chain. Reads are logged too, because '
  'on a shared clinic terminal the read log is the only real access evidence.';

CREATE INDEX audit_entity_idx ON audit.event (entity_table, entity_id, occurred_at);
CREATE INDEX audit_actor_idx  ON audit.event (actor_id, occurred_at DESC);

-- =====================================================================
--  13 · EVALUATION  (the major-project rigour)
-- =====================================================================

CREATE TABLE eval.gold_document (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bundle_label  text NOT NULL,       -- bundles, because compare is cross-document
    storage_key   text NOT NULL,
    degradation   jsonb,               -- blur, skew, jpeg quality, glare ladder
    is_derived    boolean NOT NULL DEFAULT false,
    sealed        boolean NOT NULL DEFAULT false
);

CREATE TABLE eval.gold_annotation (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    gold_document_id uuid NOT NULL REFERENCES eval.gold_document(id)
                          ON DELETE CASCADE,
    analyte_code    text NOT NULL REFERENCES core.analyte(code),
    value_text      text NOT NULL,
    unit_text       text,
    bbox_x numeric, bbox_y numeric, bbox_w numeric, bbox_h numeric,
    annotator       text NOT NULL,
    round           smallint NOT NULL CHECK (round IN (1, 2)),  -- double-abstracted
    adjudicated_by  text
);
COMMENT ON TABLE eval.gold_annotation IS
  'Double-abstracted by two people who are not the pipeline developers, with '
  'adjudication on disagreement. Inter-annotator agreement is reported per '
  'field BEFORE any system accuracy is reported.';

CREATE TABLE eval.run (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code_commit    text NOT NULL,
    reader_version text NOT NULL,
    started_at     timestamptz NOT NULL DEFAULT now(),
    checks_enabled core.check_code[] NOT NULL,   -- for per-check ablations
    notes          text
);

CREATE TABLE eval.metric (
    run_id      uuid NOT NULL REFERENCES eval.run(id) ON DELETE CASCADE,
    stratum     text NOT NULL,          -- never pooled into one headline figure
    metric_name text NOT NULL,          -- 'false_accept_rate', 'iou', ...
    value       numeric NOT NULL,
    ci_low      numeric,
    ci_high     numeric,
    PRIMARY KEY (run_id, stratum, metric_name)
);

-- =====================================================================
--  14 · GUARDRAIL ENFORCEMENT
--  R3 as a query. Run in CI; a non-empty result fails the build.
-- =====================================================================

CREATE VIEW audit.schema_guardrail_violations AS
SELECT c.table_schema, c.table_name, c.column_name
FROM information_schema.columns c
WHERE c.table_schema IN ('core', 'pat', 'proj')
  AND (
      c.column_name ~* ('(severity|abnormal|is_high|is_low|flag|alert|urgent'
                     || '|critical|risk|score|grade|rating|stratif|priority'
                     || '|rank|triage|trend|slope|delta|adherence|compliance'
                     || '|reference_low|reference_high|normal_range|target_range)')
  )
  -- the two places the words are legitimate and audited
  AND NOT (c.table_name = 'analyte_reportable_range')
  AND NOT (c.table_name = 'metric' AND c.column_name = 'value');

COMMENT ON VIEW audit.schema_guardrail_violations IS
  'The assistive boundary expressed as a test. If this view returns a row, a '
  'migration has introduced a column that could hold a clinical judgement, '
  'and CI fails. The boundary is therefore a property of the schema rather '
  'than a policy someone could relax.';

-- A value is renderable only if it is grounded and in a shown state.
CREATE VIEW proj.renderable_value AS
SELECT ev.*
FROM core.extracted_value ev
JOIN core.provenance p ON p.id = ev.provenance_id
WHERE ev.state IN ('accepted', 'confirmed')
  AND (p.kind <> 'source_document'
       OR p.bbox_x IS NOT NULL OR p.char_start IS NOT NULL);

COMMENT ON VIEW proj.renderable_value IS
  'The only view the clinician API may read clinical values from. Anything '
  'in needs_confirm never appears here, so an ungrounded value cannot reach '
  'a screen even through a coding mistake.';
