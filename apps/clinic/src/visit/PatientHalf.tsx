import { useState } from 'react'

import type { AnswerEntry, ComplianceScore, GlucoseEntry, MealPhotoEntry, PatientEntry } from '../api/client'
import { Source } from '../entries/EntryRows'
import { time } from '../entries/ticks'
import { formatDate } from '../lib/dates'
import { thumbnail } from '../lib/photos'
import { en, fmt } from '../strings/en'
import { Block } from './DocumentsHalf'
import { ScoreBlock } from './ScoreBlock'

const newestFirst = (a: PatientEntry, b: PatientEntry) => b.occurred_at.localeCompare(a.occurred_at)

const GLUCOSE_SHOWN = 10
const ANSWERS_SHOWN = 7

export function PatientHalf({ entries, score }: { entries: PatientEntry[]; score: ComplianceScore | null }) {
  const [showAllGlucose, setShowAllGlucose] = useState(false)
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
          <div className="rounded-lg border border-line bg-surface">
            {/* On a narrow screen the table scrolls on its own, not the page. */}
            <div className="overflow-x-auto rounded-lg" tabIndex={0} role="region" aria-label={en.visit.glucoseTable}>
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-line">
                  {[en.visit.date, en.visit.time, en.visit.reading, en.visit.context, en.visit.source].map((h) => (
                    <th key={h} scope="col" className="label px-3 py-2 font-normal">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {glucose.slice(0, showAllGlucose ? undefined : GLUCOSE_SHOWN).map((g) => (
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
                    <td className="px-3 py-1.5"><Source e={g} />{g.channel === 'patient_app' && g.entered_by === 'patient' && <span className="text-xs text-ink-2">{en.visit.fromApp}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            {glucose.length > GLUCOSE_SHOWN && (
              <ShowAll
                open={showAllGlucose}
                count={glucose.length}
                onToggle={() => setShowAllGlucose((o) => !o)}
              />
            )}
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
                  <img src={thumbnail(m.photo_url)} alt="" loading="lazy" className="aspect-[4/3] w-full rounded-md border border-line object-cover" />
                </a>
                <p className="numerals mt-1 text-xs text-ink-2">
                  {m.meal && <span className="font-medium text-ink">{en.entries.meals[m.meal]}, </span>}
                  {formatDate(m.occurred_at)}, {time(m.occurred_at)}
                </p>
                {m.calories_text && <p className="numerals text-xs text-ink-2">{fmt(en.entries.calories, { n: m.calories_text })}</p>}
              </li>
            ))}
          </ul>
        )}
      </Block>
    </div>
  )
}

/* Shows the rest of a list in place, rather than in a box that scrolls inside the page. */
function ShowAll({ open, count, onToggle }: { open: boolean; count: number; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="w-full border-t border-line px-3 py-2 text-left text-sm font-medium text-accent hover:bg-bg"
    >
      {open ? en.visit.showFewer : fmt(en.visit.showAll, { n: count })}
    </button>
  )
}

/* Answers grouped by question, each exactly as given, newest first. */
function Answers({ title, answers }: { title: string; answers: AnswerEntry[] }) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
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
            <ul className="mt-1 border-t border-line">
              {list.slice(0, open[list[0].question_key] ? undefined : ANSWERS_SHOWN).map((a) => (
                <li key={a.id} className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-baseline gap-3 border-b border-line py-1.5 text-sm">
                  <span className="numerals text-ink-2">{formatDate(a.occurred_at)}</span>
                  <span lang={a.language} dir={a.language === 'ur' ? 'rtl' : 'ltr'} className={a.language === 'ur' ? 'text-right' : ''}>
                    {a.answer_text}
                  </span>
                </li>
              ))}
            </ul>
            {list.length > ANSWERS_SHOWN && (
              <ShowAll
                open={!!open[list[0].question_key]}
                count={list.length}
                onToggle={() => setOpen((o) => ({ ...o, [list[0].question_key]: !o[list[0].question_key] }))}
              />
            )}
          </div>
        ))
      )}
    </Block>
  )
}
