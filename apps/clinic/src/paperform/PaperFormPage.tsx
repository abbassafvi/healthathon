import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'

import { api, ApiError } from '../api/client'
import type { AnswerEntry, PaperFormResult, TickEntry } from '../api/client'
import { LoadError } from '../app/LoadError'
import { formatDate } from '../lib/dates'
import { localIsoDate } from '../lib/localDate'
import { en, fmt } from '../strings/en'
import { cellKey, counts, toSubmission, validate, weekDates, type Draft } from './formModel'
import { GlucoseEditor } from './GlucoseEditor'
import { TickGrid } from './TickGrid'
import { PAGE } from '../app/page'

function lastWeekStart(): string {
  const d = new Date()
  d.setDate(d.getDate() - 7)
  return localIsoDate(d)
}

/*
 * Staff copy a week's paper form into the record. Days the patient already
 * recorded in the app are shown and locked, so nothing is entered twice.
 * A summary step comes before saving, and the form carries one capture id
 * from opening to saving, so saving twice cannot create two records.
 */
export function PaperFormPage() {
  const { patientId } = useParams() as { patientId: string }
  const qc = useQueryClient()
  const [captureId, setCaptureId] = useState(() => crypto.randomUUID())
  const [step, setStep] = useState<'form' | 'review' | 'saved'>('form')
  const [draft, setDraft] = useState<Draft>(() => ({ weekFrom: lastWeekStart(), language: 'en', cells: {}, glucose: [], answers: {} }))
  const [attempted, setAttempted] = useState(false)
  const [today] = useState(() => localIsoDate(new Date()))
  const dates = weekDates(draft.weekFrom)

  const patients = useQuery({ queryKey: ['patients'], queryFn: api.patients })
  const patient = patients.data?.find((p) => p.id === patientId)
  const name = patient?.full_name ?? ''
  // Answers are usually written in the patient's own language: start there.
  const languageTouched = useRef(false)
  const preferred = patient?.preferred_language
  useEffect(() => {
    if (!languageTouched.current && (preferred === 'hi' || preferred === 'ur' || preferred === 'en')) {
      setDraft((d) => ({ ...d, language: preferred }))
    }
  }, [preferred])
  const questions = useQuery({ queryKey: ['paper-questions'], queryFn: api.paperFormQuestions })
  const week = useQuery({
    queryKey: ['entries', patientId, dates[0], dates[6]],
    queryFn: () => api.entries(patientId, { from: dates[0], to: dates[6] }),
  })
  const save = useMutation<PaperFormResult, Error>({
    mutationFn: () => api.submitPaperForm(patientId, toSubmission(draft, captureId)),
    onSuccess: () => {
      setStep('saved')
      void qc.invalidateQueries({ queryKey: ['entries', patientId] })
      void qc.invalidateQueries({ queryKey: ['visit', patientId] })
    },
  })

  const locked: Record<string, 'ticked' | 'not_ticked'> = {}
  for (const t of (week.data?.entries ?? []).filter((e): e is TickEntry => e.kind === 'medication_tick')) {
    locked[cellKey(t.regimen_item.id, t.tick_date)] = t.ticked ? 'ticked' : 'not_ticked'
  }
  // Days the patient already answered in the app: shown, never retyped.
  const answered: Record<string, { text: string; language: string }> = {}
  for (const a of (week.data?.entries ?? []).filter((e): e is AnswerEntry => e.kind === 'survey_answer' && e.set === 'daily')) {
    answered[`${a.question_key}|${a.occurred_at.slice(0, 10)}`] = { text: a.answer_text, language: a.language }
  }
  const items = (week.data?.regimen_items ?? []).filter((i) => i.active_from <= dates[6] && (!i.active_until || i.active_until > dates[0]))
  const problems = attempted ? validate(draft) : []
  const submission = toSubmission(draft, captureId)
  const c = counts(submission)

  const reset = () => {
    setCaptureId(crypto.randomUUID())
    setDraft((d) => ({ ...d, cells: {}, glucose: [], answers: {} }))
    setAttempted(false)
    save.reset()
    setStep('form')
  }

  if (week.isError || questions.isError) {
    const retry = () => [week, questions].forEach((q) => q.isError && void q.refetch())
    return <Shell><LoadError message={en.paperForm.loadFailed} onRetry={retry} retrying={week.isFetching || questions.isFetching} /></Shell>
  }

  if (step === 'saved' && save.data) {
    return (
      <Shell>
        <div role="status" className="rounded-xl border border-line bg-surface px-6 py-6">
          <p className="font-medium">{save.data.duplicate ? en.paperForm.duplicate : fmt(en.paperForm.saved, { n: save.data.created })}</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link to={`/patients/${patientId}/timeline`} className="inline-flex h-9 items-center rounded-lg border border-accent bg-accent px-3.5 text-sm font-medium text-accent-ink hover:bg-accent-hover">
              {en.paperForm.viewTimeline}
            </Link>
            <button type="button" onClick={reset} className="inline-flex h-9 items-center rounded-lg border border-line-strong bg-surface px-3.5 text-sm font-medium hover:bg-bg">
              {en.paperForm.another}
            </button>
          </div>
        </div>
      </Shell>
    )
  }

  if (step === 'review') {
    const err = save.error
    return (
      <Shell>
        <section aria-labelledby="summary" className="rounded-xl border border-line bg-surface px-6 py-6">
          <h2 id="summary" className="text-lg font-semibold">{en.paperForm.summaryTitle}</h2>
          <p className="mt-1 text-ink-2">{fmt(en.paperForm.summaryFor, { name, from: formatDate(dates[0]), to: formatDate(dates[6]) })}</p>
          <ul className="mt-4 flex flex-col gap-1 text-sm">
            <li>{fmt(en.paperForm.summaryTicks, { ticked: c.ticked, notTicked: c.notTicked })}</li>
            <li>{fmt(en.paperForm.summaryReadings, { n: c.readings })}</li>
            <li>{fmt(en.paperForm.summaryAnswers, { n: c.answers })}</li>
            <li className="text-ink-2">{en.paperForm.summaryBlank}</li>
          </ul>
          {err && (
            <p role="alert" className="mt-4 text-sm">
              {err instanceof ApiError && err.status === 409 ? en.paperForm.conflict : en.paperForm.failed}
            </p>
          )}
          <div className="mt-5 flex flex-wrap gap-3">
            <button type="button" onClick={() => save.mutate()} disabled={save.isPending}
              className="inline-flex h-10 items-center rounded-lg border border-accent bg-accent px-4 text-sm font-medium text-accent-ink hover:bg-accent-hover disabled:opacity-60">
              {en.paperForm.save}
            </button>
            <button type="button" onClick={() => setStep('form')} className="inline-flex h-10 items-center rounded-lg border border-line-strong bg-surface px-4 text-sm font-medium hover:bg-bg">
              {en.paperForm.back}
            </button>
          </div>
        </section>
      </Shell>
    )
  }

  return (
    <Shell>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          setAttempted(true)
          if (validate(draft).length === 0) setStep('review')
        }}
        className="flex flex-col gap-10"
      >
        <div>
          <h2 className="text-lg font-semibold">{en.paperForm.title}</h2>
          <p className="mt-1 text-sm text-ink-2">{en.paperForm.intro}</p>
          <div className="mt-4 flex flex-wrap items-end gap-6">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="week-from" className="label">{en.paperForm.weekStarts}</label>
              <input id="week-from" type="date" value={draft.weekFrom} max={today}
                onChange={(e) => e.target.value && setDraft({ ...draft, weekFrom: e.target.value, cells: {}, answers: {}, glucose: [] })}
                className="h-10 rounded-lg border border-line-strong bg-surface px-3" />
            </div>
            <p className="pb-2 text-sm text-ink-2">{fmt(en.paperForm.weekRange, { from: formatDate(dates[0]), to: formatDate(dates[6]) })}</p>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="form-language" className="label">{en.paperForm.language}</label>
              <select id="form-language" value={draft.language} onChange={(e) => {
                  languageTouched.current = true
                  setDraft({ ...draft, language: e.target.value as Draft['language'] })
                }}
                className="h-10 rounded-lg border border-line-strong bg-surface px-3">
                {Object.entries(en.entries.languages).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
        </div>

        {problems.length > 0 && (
          <div role="alert" className="rounded-xl border-2 border-ink bg-surface px-4 py-3 text-sm">
            <p className="font-medium">{en.paperForm.fix}</p>
            <ul className="mt-1 list-disc pl-5">
              {problems.map((p) => <li key={p.field}><a href={`#${p.field}`} className="underline underline-offset-2">{p.message}</a></li>)}
            </ul>
          </div>
        )}

        <section aria-labelledby="pf-ticks">
          <h3 id="pf-ticks" className="mb-1 text-base font-semibold">{en.paperForm.medicines}</h3>
          {!week.data ? <div className="h-40 rounded-xl bg-sunken" aria-busy="true" /> : items.length === 0 ? (
            <p className="text-sm text-ink-2">{en.paperForm.noChecklist}</p>
          ) : (
            <>
              <p className="mb-3 max-w-[60ch] text-sm text-ink-2">{en.paperForm.medicinesHelp}</p>
              <div className="overflow-x-auto">
                <TickGrid items={items} dates={dates} locked={locked} cells={draft.cells}
                  onChange={(k, v) => setDraft((d) => ({ ...d, cells: { ...d.cells, [k]: v } }))} />
              </div>
              <p className="mt-2 flex items-center gap-2 text-xs text-ink-2">
                <span aria-hidden className="inline-block size-4 rounded border border-dashed border-line bg-sunken" />
                {en.paperForm.lockedFromApp}
              </p>
            </>
          )}
        </section>

        <section aria-labelledby="pf-glucose">
          <h3 id="pf-glucose" className="mb-3 text-base font-semibold">{en.paperForm.glucose}</h3>
          <GlucoseEditor rows={draft.glucose} dates={dates} problems={problems} onChange={(glucose) => setDraft((d) => ({ ...d, glucose }))} />
        </section>

        {questions.data?.map((q) => (
          <section key={q.key} aria-labelledby={`pf-q-${q.key}`}>
            <h3 id={`pf-q-${q.key}`} className="text-base font-semibold">{en.paperForm.answers}</h3>
            <p className="mb-3 text-sm text-ink-2">{q.text}</p>
            <div className="grid gap-2 sm:grid-cols-[9rem_minmax(0,28rem)]">
              {dates.map((d) => {
                const k = `${q.key}|${d}`
                const id = `answer-${k}`
                const fromApp = answered[k]
                if (fromApp !== undefined) {
                  return (
                    <div key={k} className="contents" data-answer-locked>
                      <span className="self-center text-sm text-ink-2">{formatDate(d)}</span>
                      <p className="flex min-h-10 flex-wrap items-center gap-x-3 rounded-lg border border-dashed border-line bg-sunken px-3 py-2">
                        <span lang={fromApp.language} dir={fromApp.language === 'ur' ? 'rtl' : 'ltr'}>{fromApp.text}</span>
                        <span className="text-xs text-ink-2">{en.paperForm.lockedFromApp}</span>
                      </p>
                    </div>
                  )
                }
                return (
                  <div key={k} className="contents">
                    <label htmlFor={id} className="self-center text-sm text-ink-2">{formatDate(d)}<span className="sr-only">, {fmt(en.paperForm.answerFor, { date: formatDate(d) })}</span></label>
                    <input id={id} lang={draft.language} dir={draft.language === 'ur' ? 'rtl' : 'ltr'} value={draft.answers[k] ?? ''}
                      onChange={(e) => setDraft((x) => ({ ...x, answers: { ...x.answers, [k]: e.target.value } }))}
                      className="h-10 rounded-lg border border-line-strong bg-surface px-3" />
                  </div>
                )
              })}
            </div>
          </section>
        ))}

        <div className="flex">
          <button type="submit" className="inline-flex h-10 items-center rounded-lg border border-accent bg-accent px-4 text-sm font-medium text-accent-ink hover:bg-accent-hover">
            {en.paperForm.review}
          </button>
        </div>
      </form>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className={`${PAGE} pt-6 pb-16`}>{children}</main>
}
