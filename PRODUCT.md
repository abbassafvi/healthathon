# Product

## Register

product

## Users

Two groups, on two surfaces.

**Clinic side (web, `apps/clinic`).** Clinicians and transcription verifiers at a
diabetes clinic in India. They sit at a shared desk terminal between or during
consultations, often interrupted. Their jobs: settle values the reader could not
stand behind (the confirm queue), check any value against the page it came from
(the trace view), and read one page per visit that brings documents and the
patient's own entries together in date order.

**Patient side (Android app, `apps/patient`).** People living with diabetes,
recording between visits: medicine ticks, glucose readings, the day's question,
a short survey, meal photographs. English, Hindi or Urdu. Some are older, some
are first-time smartphone users, some are helped by a family member.

## Product Purpose

Consultation readiness and continuous follow-up in diabetes care. A clinician
photographs a handwritten prescription or printed lab report; the system shows a
value only if it can be traced to a region on that page, and sends everything
else to a person with the crop. The confirmed prescription becomes the patient's
daily checklist, and what the patient records reaches the doctor without anyone
typing it in.

Success: a reviewer settles a queue item in under five seconds while actually
looking at the crop; every value on screen taps back to its source; the patient
records a day in under a minute.

The system is assistive, not diagnostic. It never diagnoses, recommends, grades
or interprets. That boundary is a design constraint on every screen.

## Brand Personality

Exact, calm, accountable. It reads like a well-made clinical instrument: the
document image is the subject, the interface steps back. It states facts about
the record in plain words and never editorialises about the patient. Confidence
comes from provenance being visible, not from polish.

## Anti-references

- SaaS dashboards: KPI tiles, hero metrics, gradient accents, cards everywhere.
- Red, amber and green alerting, or any colour that implies a value is good or
  bad. This is also forbidden by the assistive boundary.
- Hospital EMR clutter: dense grey forms, tiny tabs, everything on screen at once.

## Design Principles

1. **The source is the subject.** The crop or page image is the largest, first
   thing on any screen that shows a value. Text is a caption to the evidence.
2. **Facts, never judgements.** Show values exactly as printed, in date or
   arrival order. Nothing is ranked, highlighted, coloured or summarised by
   clinical meaning. Colour carries state of the record, never state of health.
3. **Looking comes before deciding.** No control acts on a value until its image
   has rendered. Speed is earned by keyboard flow, not by skipping the look.
4. **Say what is built.** States, errors and gaps are named plainly ("no
   matching report in this record"), never softened or dramatised.
5. **One task per screen.** Each screen does one job, with what it needs for that
   job and nothing else.

## Accessibility & Inclusion

- WCAG 2.2 AA throughout.
- Every clinic workflow is fully operable from the keyboard, with visible focus.
- No meaning carried by colour alone.
- `prefers-reduced-motion` respected everywhere.
- Patient app: three languages including Urdu (right to left), large touch
  targets, plain words, tolerant of older eyes and first-time smartphone users.
