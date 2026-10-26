# apps/patient: the patient Android app (Expo)

The repository-wide rules in `../../AGENTS.md` apply here in full, above
everything below: assistive not diagnostic, no real patient data, test
everything, no em or en dashes, Conventional Commits, never commit to main.

In this app specifically: nothing interpretive is ever shown to the patient.
No chart, average, trend, score, target, range, or colour that means good or
bad. The patient sees what they recorded, as they recorded it.

---

This is an Expo (React Native) app for Android, also run on Expo's web
target for tests.

## Expo changes between releases: check the docs, not memory

Expo ships breaking changes in every SDK release. Before writing code that
touches an Expo or React Native API:

1. Read the major version of `expo` in `package.json` (58 at the time of writing).
2. Read the matching docs: `https://docs.expo.dev/versions/v<major>.0.0/`.
3. For anything else, start from https://docs.expo.dev/llms.txt and follow
   its links to the page you need.

## Commands

```bash
npx expo install <package>  # add packages this way: it picks SDK-compatible versions
npx expo start              # dev server: a for Android, w for web
npm run check               # types and Jest
npm run e2e                 # Playwright and axe on the web build
npx expo-doctor             # diagnose dependency and config issues
```

`npx expo install` runs whichever npm is on `PATH`. npm 10.8 crashes on this
workspace, so put npm 11 first on `PATH` for that command.

## How this app is put together

- Navigation is plain state in `App.tsx` (Welcome, Today, Survey). There is no
  Expo Router; add it only if the app grows past a handful of screens.
- Every screen talks to the `PatientApi` interface (`src/data/types.ts`). The
  in-memory mock (`src/data/mockApi.ts`) implements it until the endpoints
  exist; see `docs/HANDOFF.md`.
- All text goes through `src/components/Txt.tsx`, which sets the font, line
  height and direction for the script. Urdu is set in Nastaliq and the layout
  mirrors.
- Every visible string lives in `src/i18n/en.ts`, `hi.ts` and `ur.ts`, with
  the same keys. Hindi and Urdu are drafts until a speaker reviews them.

## Rules

- `ios/` and `android/` are generated. Configure native behaviour in
  `app.json` and config plugins, not by editing those folders.
- Expo Go has only its bundled native modules. After adding a library with
  native code, build a development build (`npx expo run:android`).
- Prefer Expo's own modules over third-party libraries.
