# Work split: two parallel tracks

Build window 13 October to 8 November 2026. Demonstration 28 November.
Two people, working in parallel from day four.

Scope is defined in [Prototype-Scope.pdf](Prototype-Scope.pdf). This document
says only who builds what, and how the two tracks avoid blocking each other.

## The rule that keeps the tracks parallel

Neither track ever waits for the other's output to exist. Two mechanisms buy
that, and both are set up in week one.

### Seed data, shipped by Abbas in week 1

A script that writes realistic `extracted_value` and `provenance` rows, with
real crop images, straight into the database. No pipeline involved.

Saadat then builds the confirm queue, the trace view and the visit page against
seed data from day four. Without this he is blocked until the reader works, and
the reader is the least predictable thing in the project.

This is Abbas's first deliverable after the vertical slice. It is not optional
and it is not a nice-to-have.

### A frozen contract

Three artefacts, frozen on a date, changed only by agreement between both of us.

| What | Owner | Frozen by |
| --- | --- | --- |
| Database schema and migrations | Abbas | End of week 1 |
| OpenAPI spec for every endpoint Saadat consumes | Both, agreed day 2 | End of week 1 |
| English interface strings | Saadat | End of week 2, then sent for translation |

Changing a frozen artefact is allowed. Changing it without telling the other
person is not, because both tracks are built against it.

## Track A, Abbas: documents and data integrity

The reading pipeline, the deterministic layer, and everything that decides
whether a value is true.

- Schema, migrations, the guardrail lint, and narrowing it for `pat.compliance_score`
- Capture, normalisation, PaddleOCR detector, the vision model call
- Printed lab report path, recogniser on, eight analytes
- Drug list matching, confidence floor, dose format rules
- Routing logic: what passes, what goes to the queue, and the reason recorded
- Append-only audit chain
- Gold set tooling, perturbation suite, the metrics script
- **The seed script, week 1, before anything else**

## Track B, Saadat: surfaces and between-visit collection

Everything a human touches.

- Confirm queue interface: the crop renders before the controls enable, keyboard driven
- Tap-to-crop trace view, which is the most rehearsed interaction in the demonstration
- Patient app: medicine ticks, glucose entry, the day's question, the survey, meal photographs
- Languages: string externalisation, the switcher, Hindi and Urdu loaded
- Paper form route and the inbound SMS endpoint
- Patient timeline and the visit page
- Compliance score: computation from ticks, and display, against the table Abbas provides

Abbas is on Track A because he has already been inside the schema, the
provenance model and the OCR architecture decisions. Swap the tracks if that
turns out to be the wrong way round. The split itself holds either way.

## Week by week

| Week | Abbas | Saadat |
| --- | --- | --- |
| **1** (13 to 19 Oct) | Vertical slice (joint, days 1 to 3). Schema frozen. **Seed script.** Detector returning boxes. First model call | Vertical slice (joint). OpenAPI agreed. App shell, routing, auth stub. Confirm queue skeleton on seed data |
| **2** (20 to 26 Oct) | Drug matching, confidence floor, routing with reasons. Printed lab path | Confirm queue finished. Trace view. **English strings frozen and sent for translation** |
| **3** (27 Oct to 2 Nov) | Perturbation suite, metrics script. `pat.compliance_score` migration and the lint change | Patient app in full. Paper and SMS routes. Compliance score. Hindi and Urdu loaded |
| **4** (3 to 8 Nov) | Cached replay mode. Held-out evaluation run | Visit page, both halves side by side. Polish |

Feature freeze on the Wednesday of week 4. Two rehearsals after that, on the
machine that will be used on the day.

## Joint work, not split

**The vertical slice, days 1 to 3.** A photograph goes in one end and a value
comes out the other, with every stage bad. Both of us, together, before the
tracks separate. It is how we find the integration problems in week one instead
of week four.

**Gold set annotation, weeks 2 and 3.** Both of us annotate independently and
disagreements are adjudicated. This cannot be given to one person: inter-annotator
agreement needs two annotators, and there are two of us. Agreement is reported
before any accuracy figure.

**Demonstration rehearsal, week 4.**

## Where one track can still block the other

| Risk | Mitigation |
| --- | --- |
| Saadat waits on real extracted values | The seed script. It is Abbas's first deliverable for a reason |
| Abbas waits on the clinical lead's document set | Write twenty prescriptions ourselves in week 1 as a stand-in, swap them when the real set arrives |
| Compliance score needs a table that does not exist yet | Abbas ships the migration at the start of week 3, before Saadat needs it |
| Translations do not come back in time | Ship English and leave the switcher in place. The strings file is the deliverable, and a language can be added afterwards in an hour |

## Day-one dependencies, requested by Abbas on 13 October

These are not code, they depend on other people, and they have the longest lead
time in the project.

1. **The drug list.** The forty to sixty drugs actually prescribed at that clinic.
2. **The document set.** Thirty to fifty handwritten prescriptions for fictional
   patients, photographed on a mid-range phone, some recompressed through a
   messaging app, some shot in poor light. Five to ten printed laboratory reports
   in the same batch.
3. **The translations.** Roughly eighty interface strings in Hindi and Urdu,
   reviewed by a speaker. Machine translation is not acceptable in an interface a
   patient has to trust.

No real patient data at any stage.

## Cut list, if week 3 slips

Decided now, in this order: Urdu (keep Hindi), meal photographs, the survey
(keep the single daily question), the SMS endpoint, printing.
