import type { SurveyForm } from '../api/client'
import { formatDateTime } from '../lib/dates'
import { en, fmt } from '../strings/en'

/*
 * Paper surveys photographed at the desk, newest first. They are shown as
 * the photographs they are: nothing on them is read, so there is no value
 * to trace and nothing to confirm.
 */
export function SurveyForms({ forms }: { forms: SurveyForm[] }) {
  if (forms.length === 0) return null
  return (
    <section aria-labelledby="survey-forms">
      <h2 id="survey-forms" className="border-b border-line pb-2 text-base font-semibold">{en.record.surveys}</h2>
      <ul className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(9rem,1fr))] gap-4">
        {forms.map((f) => {
          const label = fmt(en.record.surveyPhoto, { when: formatDateTime(f.photographed_at) })
          return (
            <li key={f.id} className="flex flex-col gap-1.5">
              <a href={f.url} target="_blank" rel="noreferrer" className="block rounded-md focus-visible:outline-2 focus-visible:outline-accent">
                <img
                  src={`${f.url}?width=360`}
                  alt={label}
                  width={f.width_px}
                  height={f.height_px}
                  loading="lazy"
                  className="aspect-[3/4] h-auto w-full rounded-md border border-line bg-surface object-contain"
                />
                <span className="sr-only">{en.record.surveyOpen}</span>
              </a>
              <span className="numerals text-xs text-ink-2">{formatDateTime(f.photographed_at)}</span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
