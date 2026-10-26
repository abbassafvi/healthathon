# Instructions for AI agents working in this repository

Read this before writing code, prose, or commits. These rules override default
behaviour.

This is clinical software. It handles prescriptions, laboratory values and
patient-reported data. A mistake here is not a cosmetic bug, so the bar for
"done" is higher than usual and the shortcuts that are acceptable elsewhere are
not acceptable here.

## 1. The boundary this project is built on

The system is **assistive, not diagnostic**. It does not diagnose, recommend
treatment, stratify clinical risk, or return anything interpretive to the
patient.

Do not add, and do not suggest adding:

- A diagnosis, a treatment suggestion, or a clinical risk score
- A reference range, a target, a threshold line, or a colour that encodes
  good or bad
- A chart, average or trend shown to the **patient**
- A portion, calorie or macronutrient estimate from a meal photograph
- A score, total or trend computed over survey answers or free-text reports

The one approved exception is the clinician-facing compliance score. It is
computed from medication ticks only, never from self-reported text, and it is
never shown to the patient. Every score must be reversible to the day array it
came from.

The boundary is enforced in the database, not in code review.
`audit.schema_guardrail_violations` fails the build if a judgement column
appears in the `core`, `pat` or `proj` schemas. **Do not weaken or delete that
view to make a feature fit.** If a feature genuinely needs an exception, raise
it with a human and narrow the lint to one named table.

### A value is never shown without its provenance

`core.extracted_value.provenance_id` is `NOT NULL` by design. A value the system
cannot trace back to a region on a page does not get displayed. Do not add a
code path that writes a value without provenance, however convenient it is for a
test fixture or a demo.

## 2. Data rules

- **No real patient data at any stage.** Fictional patients only.
- Never commit a document from the document set, a gold set annotation, or a
  crop. `.gitignore` already excludes them; do not add exceptions.
- Never commit a credential, an API key or a `.env` file.
- If you find real patient data in the working tree, stop and tell a human.
  Do not commit it, and do not try to clean it up yourself.

## 3. Testing

**If you did not test it, it does not work.** This is not a slogan, it is the
acceptance condition.

### Before every commit

Every one of these must pass. Not most of them.

- Unit tests for the code you changed
- Type checks
- Lint
- The schema guardrail lint, if you touched anything under `db/`
- A smoke run of the affected path, with the actual output looked at

Do not commit with a failing test and a note saying you will fix it. Do not
disable, skip or loosen a test so a commit can land. If a test is genuinely
wrong, fix the test in its own commit and say why in the message.

### On every pull request and every merge

The **full regression suite** runs, not just the tests for the changed area.
A pull request does not merge on a red suite.

This matters more here than in a typical project, because the failure mode is
quiet. A change to the deterministic layer can leave every unit test green while
sending twice as many values to the confirm queue, which is safe and useless.
Regression over the gold set is what catches that.

### Reporting results

Report what actually happened. If tests fail, say so and paste the output. If
you skipped a step, say which one and why. Do not describe work as verified when
you did not run it.

## 4. Frontend development

Use the installed skills rather than improvising. They exist so the interface
stays consistent across two people working in parallel, and so the result does
not read as generated.

**`impeccable` is the primary frontend skill.** Invoke it for any interface
work before writing components by hand. It covers design, critique, audit,
polish, layout, typography, colour, motion, accessibility and anti-pattern
detection, through subcommands:

```
/impeccable shape <target>      start a design
/impeccable critique <target>   review what exists
/impeccable audit <target>      accessibility and anti-patterns
/impeccable polish <target>     tighten a nearly-finished surface
/impeccable layout <target>     spacing, alignment, hierarchy
/impeccable harden <target>     error states, edge cases, empty states
```

`/impeccable` with no argument lists the rest.

The others, for the jobs impeccable does not cover:

| Skill | When |
| --- | --- |
| `shadcn` | Adding or composing components, anywhere `components.json` exists |
| `frontend-testing` | Vitest and React Testing Library tests for components, hooks and utilities |
| `frontend-code-review` | Reviewing `.tsx`, `.ts` and `.js` changes before they merge |
| `e2e-tester` | Playwright end-to-end tests |
| `component-refactoring` | A component that has grown too complex to follow |

Two interface rules that are not style preferences:

- In the **confirm queue**, the crop must finish rendering before the controls
  enable. A reviewer who can approve a value before seeing the image is not
  reviewing anything.
- In the **patient app**, nothing interpretive is returned. See section 1.

## 5. Writing

Applies to everything: prose, documentation, commit messages, code comments,
interface copy, and anything rendered inside an image, diagram or SVG.

### Never use em dashes or en dashes

No em dash (U+2014) and no en dash (U+2013) as a sentence connector, anywhere,
for any reason. Rewrite the sentence instead. Use a comma, a colon, a
semicolon, brackets, or two sentences, whichever fits the meaning. Hyphens in ranges and scores (pp. 474-489, 3-1) are
fine.

When editing an existing file, remove any em dashes already present in the parts
you touch.

### Do not write text that reads as machine-generated

- **No padding openers.** Not "In today's fast-paced world", "It's important to
  note that", "It's worth mentioning", "Let's dive in", "Great question!".
- **No not-just-X-but-Y frame.** Not "It isn't just a tool, it's a platform."
  State what it is.
- **No inflated register.** Avoid delve, tapestry, realm, landscape, testament
  to, treasure trove, game-changer, revolutionise, unlock, harness, seamless,
  robust, cutting-edge, leverage (as a verb), navigate (figuratively), elevate,
  embark, foster, pivotal, crucial, meticulous.
- **No rule-of-three padding.** Use the number of items the meaning requires.
- **No empty summary paragraphs.** Do not close a section by restating it.
- **No hedge stacking.** Not "may potentially possibly". Commit to a claim, or
  state the uncertainty once and precisely.
- **No decorative emoji** in prose, headings or commit messages.
- **No bold scattered through a paragraph** for emphasis the sentence structure
  should carry.

Prefer short declarative sentences, concrete nouns and the active voice. Vary
sentence length, because real writing does. If a sentence survives deleting a
word, delete the word.

Academic and formal writing follows the same rules. Formal does not mean
inflated.

## 6. Git practice

- **Conventional Commits.** `feat:`, `fix:`, `docs:`, `refactor:`, `test:`,
  `chore:`, `perf:`, `ci:`. Scope where it helps: `feat(confirm-queue):`.
- **Never commit directly to `main`.** Branch, then open a pull request.
  Branch names: `feat/confirm-queue-crop-gate`, `fix/provenance-null-path`.
- **One logical change per commit.** If the message needs the word "and", it is
  probably two commits.
- **The subject line says what changed and why**, not which files moved. Under
  seventy-two characters, imperative mood, no trailing full stop.
- **Rebase your branch on `main` before opening a pull request.** Keep the
  history readable.
- **Never force-push a shared branch.** `--force-with-lease` on your own branch
  only.
- **Never rewrite published history on `main`.**
- **A pull request needs the other person's review** before it merges. Two
  people, two tracks, and the review is how each of us finds out what the other
  changed.
- **Never commit generated artefacts, build output, model weights or crops.**

Commit only when a human asks you to. Do not push on your own initiative.

## 7. Code

- **Search before writing.** Grep for existing utilities, hooks, helpers and
  tests. Extend something that is already eighty percent right rather than
  writing a second version of it.
- **Keep files between 200 and 300 lines.** Past that, split by responsibility:
  one module, one concern. Separate logic from presentation.
- **Comment sparingly inline.** Document a method with a block comment above it
  explaining why it exists, not what each line does.
- **One task per invocation** when working from a task list. Complete it, commit,
  stop. Do not batch.

## 8. Project context

| | |
| --- | --- |
| Build window | 13 October to 8 November 2026 |
| Feature freeze | Wednesday of the final build week |
| Demonstration | 28 November 2026 |
| Database | PostgreSQL 16, needs the `citext` extension |

Scope is in `docs/Prototype-Scope.pdf`. Anything not in that document is out of
scope. If you think something should be added, say so and let a human decide.
Do not widen the scope yourself.

The work split between the two tracks is in `docs/work-split.md`. The current
state of the build, the endpoints still mocked, and the next steps are in
`docs/HANDOFF.md`: read it before starting work. Three
artefacts are frozen and must not be changed unilaterally: the database schema,
the OpenAPI spec, and the English interface strings.
