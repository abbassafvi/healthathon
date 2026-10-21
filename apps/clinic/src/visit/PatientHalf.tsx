import type { AnswerEntry, ComplianceScore, GlucoseEntry, MealPhotoEntry, PatientEntry } from '../api/pending'
import { Source } from '../entries/EntryRows'
import { time } from '../entries/ticks'
import { formatDate } from '../lib/dates'
import { en, fmt } from '../strings/en'
import { Block } from './DocumentsHalf'
import { ScoreBlock } from './ScoreBlock'

const newestFirst = (a: PatientEntry, b: PatientEntry) => b.occurred_at.localeCompare(a.occurred_at)

export function PatientHalf({ entries, score }: { entries: PatientEntry[]; score: ComplianceScore | null }) {
  const glucose = entries.filter((e): e is GlucoseEntry => e.kind === 'glucose_reading').sort(newestFirst)
  const answers = entries.filter((e): e is AnswerEntry => e.kind === 'survey_answer').sort(newestFirst)
  const meals = entries.filter((e): e is MealPhotoEntry => e.kind === 'meal_photo').sort(newestFirst)

  return (
    <div className="flex flex-col gap-8">
      <Block title={en.visit.medicines}>
        <ScoreBlock score={score} entries={entries} />
      </Block>
      <Block title={en.visit.glucose} aside={glucose.length ? fmt(en.visit.glucoseCount, { n: glucose.length }) : undefined}>
        {glucose.length === 0 ? (
          <p className="text-sm text-ink-2">{en.visit.noGlucose}</p>
        ) : (
          <div tabIndex={0} role="region" aria-label={en.visit.glucoseTable} className="max-h-80 overflow-y-auto rounded-lg border border-line bg-surface">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-line">
                  {[en.visit.date, en.visit.time, en.visit.reading, en.visit.context, en.visit.source].map((h) => (
                    <th key={h} scope="col" className="label px-3 py-2 font-normal">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {glucose.map((g) => (
                  <tr key={g.id} className="border-b border-line last:border-0">
                    <td className="numerals px-3 py-1.5 whitespace-nowrap text-ink-2">{formatDate(g.occurred_at)}</td>
                    <td className="numerals px-3 py-1.5 font-mono text-xs text-ink-3">{time(g.occurred_at)}</td>
                    <td className="numerals px-3 py-1.5 whitespace-nowrap">
                      <span className="font-semibold">{g.value_text}</span> <span className="text-ink-3">{en.entries.glucoseUnit}</span>
                      {g.insulin_units !== null && (
                        <span className="block text-xs text-ink-2">{fmt(en.entries.insulin, { units: g.insulin_units })}</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">{en.entries.contexts[g.context] ?? g.context}</td>
                    <td className="px-3 py-1.5"><Source e={g} />{g.channel === 'patient_app' && g.entered_by === 'patient' && <span className="font-mono text-xs text-ink-3">{en.visit.fromApp}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Block>
      <Answers title={en.visit.answers} answers={answers.filter((a) => a.set === 'daily')} />
      <Answers title={en.visit.survey} answers={answers.filter((a) => a.set === 'survey')} />
      <Block title={en.visit.meals}>
        {meals.length === 0 ? (
          <p className="text-sm text-ink-2">{en.visit.noMeals}</p>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(7rem,1fr))] gap-3">
            {meals.map((m) => (
              <li key={m.id}>
                <a href={m.photo_url} target="_blank" rel="noreferrer" className="block rounded-md" aria-label={`${en.entries.openPhoto}, ${formatDate(m.occurred_at)} ${time(m.occurred_at)}`}>
                  <img src={m.photo_url} alt="" loading="lazy" className="aspect-[4/3] w-full rounded-md border border-line object-cover" />
                </a>
                <p className="numerals mt-1 text-xs text-ink-2">{formatDate(m.occurred_at)}, {time(m.occurred_at)}</p>
              </li>
            ))}
          </ul>
        )}
      </Block>
    </div>
  )
}

/* Answers grouped by question, each exactly as given, newest first. */
function Answers({ title, answers }: { title: string; answers: AnswerEntry[] }) {
  const byQuestion = new Map<string, AnswerEntry[]>()
  for (const a of answers) byQuestion.set(a.question_key, [...(byQuestion.get(a.question_key) ?? []), a])
  return (
    <Block title={title}>
      {answers.length === 0 ? (
        <p className="text-sm text-ink-2">{en.visit.noAnswers}</p>
      ) : (
        [...byQuestion.values()].map((list) => (
          <div key={list[0].question_key} className="mb-4 last:mb-0">
            <p className="text-sm text-ink-2">{list[0].question_text}</p>
            <ul tabIndex={0} aria-label={list[0].question_text} className="mt-1 max-h-56 overflow-y-auto border-t border-line">
              {list.map((a) => (
                <li key={a.id} className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline gap-3 border-b border-line py-1.5 text-sm">
                  <span className="numerals text-ink-2">{formatDate(a.occurred_at)}</span>
                  <span lang={a.language} dir={a.language === 'ur' ? 'rtl' : 'ltr'} className={a.language === 'ur' ? 'text-right' : ''}>
                    {a.answer_text}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </Block>
  )
}
