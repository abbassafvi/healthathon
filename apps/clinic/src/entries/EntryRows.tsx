import type { AnswerEntry, GlucoseEntry, MealPhotoEntry, PatientEntry } from '../api/pending'
import { en, fmt } from '../strings/en'
import { time } from './ticks'

/*
 * Where an entry came from, in words. The usual case (the patient, in the
 * app) is left unmarked so the exceptions stand out; pages that show
 * entries say so once at the top (en.entries.defaultSource).
 */
export function Source({ e }: { e: PatientEntry }) {
  if (e.channel === 'patient_app' && e.entered_by === 'patient') return null
  const who =
    e.entered_by === 'caregiver' && e.caregiver_name
      ? fmt(en.entries.enteredByCaregiver, { name: e.caregiver_name })
      : e.entered_by === 'clinic_staff'
        ? en.entries.enteredByStaff
        : null
  return (
    <span className="font-mono text-xs text-ink-3">
      {en.entries.channels[e.channel] ?? e.channel}
      {who && `, ${who}`}
    </span>
  )
}

export function GlucoseRow({ e }: { e: GlucoseEntry }) {
  return (
    <div className="grid grid-cols-[3rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-0.5">
      <span className="numerals font-mono text-xs text-ink-3">{time(e.occurred_at)}</span>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="label">{en.entries.glucose}</span>
        <span className="numerals text-lg font-semibold">{e.value_text}</span>
        {/* The app and the paper form collect readings in mg/dL only. */}
        <span className="text-sm text-ink-3">{en.entries.glucoseUnit}</span>
        <span className="text-sm text-ink">{en.entries.contexts[e.context] ?? e.context}</span>
        {e.insulin_units !== null && (
          <span className="text-sm text-ink-2">{fmt(en.entries.insulin, { units: e.insulin_units })}</span>
        )}
      </p>
      <span />
      <Source e={e} />
    </div>
  )
}

export function AnswerRow({ e }: { e: AnswerEntry }) {
  const rtl = e.language === 'ur'
  const lang = en.entries.languages[e.language] ?? e.language
  return (
    <div className="grid grid-cols-[3rem_minmax(0,1fr)] items-baseline gap-x-3 gap-y-0.5">
      <span className="numerals font-mono text-xs text-ink-3">{time(e.occurred_at)}</span>
      <div className="min-w-0">
        <p className="label">{e.set === 'daily' ? en.entries.dailyQuestion : en.entries.survey}</p>
        <p className="text-sm text-ink-2">{e.question_text}</p>
        <p lang={e.language} dir={rtl ? 'rtl' : 'ltr'} className={`mt-0.5 text-base text-ink ${rtl ? 'text-right' : ''}`}>
          {e.answer_text}
        </p>
      </div>
      <span />
      <span className="flex flex-wrap gap-x-2 font-mono text-xs text-ink-3">
        {e.language !== 'en' && <span>{fmt(en.entries.answeredIn, { language: lang })}</span>}
        <Source e={e} />
      </span>
    </div>
  )
}

export function MealRow({ e }: { e: MealPhotoEntry }) {
  return (
    <div className="grid grid-cols-[3rem_minmax(0,1fr)] items-start gap-x-3 gap-y-0.5">
      <span className="numerals font-mono text-xs text-ink-3">{time(e.occurred_at)}</span>
      <div className="flex items-start gap-3">
        <a href={e.photo_url} target="_blank" rel="noreferrer" className="shrink-0 rounded-md" aria-label={en.entries.openPhoto}>
          <img
            src={e.photo_url}
            alt={fmt(en.entries.mealAlt, { time: time(e.occurred_at) })}
            loading="lazy"
            className="h-16 w-20 rounded-md border border-line object-cover"
          />
        </a>
        <div>
          <p className="label">{en.entries.meal}</p>
          <Source e={e} />
        </div>
      </div>
    </div>
  )
}
