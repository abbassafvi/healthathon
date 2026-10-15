@AGENTS.md

# Quick reference

Read `AGENTS.md` in full before working in this repository. The points below
are the ones most often skipped.

## Before you commit

```
<unit tests>      the tests for what you changed
<type check>
<lint>
<schema lint>     only if you touched db/
```

All green, or you do not commit. On a pull request, the full regression suite
runs, not just the changed area.

## Never

- Add a diagnosis, treatment suggestion, clinical risk score, reference range
  or target
- Return anything interpretive to the patient: no chart, no average, no trend,
  no colour that encodes good or bad
- Weaken or delete `audit.schema_guardrail_violations` to make a feature fit
- Write an `extracted_value` without its `provenance_id`
- Commit a prescription photograph, a crop, a gold set annotation, a credential
  or a `.env` file
- Commit straight to `main`
- Use an em dash or an en dash, anywhere, including inside generated images,
  diagrams and SVGs

## Frontend

`/impeccable` first, before hand-writing components. `/impeccable critique` and
`/impeccable audit` before a frontend pull request.

## Writing

Short declarative sentences. Active voice. Concrete nouns. No padding openers,
no inflated register, no rule-of-three padding, no empty summary paragraphs, no
decorative emoji. If a sentence survives deleting a word, delete the word.
