import { useQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router'

import { api } from '../api/client'
import { LoadError } from '../app/LoadError'
import { PAGE } from '../app/page'
import { useTitle } from '../app/useTitle'
import { en, fmt } from '../strings/en'
import { CARD, CARD_LANGS, REVIEWED, type CardLang } from './cardStrings'
import { SmsCard } from './SmsCard'

const LANG_FONT: Record<CardLang, string> = { en: '', hi: 'font-deva', ur: 'font-urdu' }

/*
 * The clinic's SMS number, kept on this computer until a gateway gives the
 * clinic a real one to store. Storage can be unavailable (private windows,
 * blocked site data); the field then simply starts empty.
 */
const NUMBER_KEY = 'smsCard.clinicNumber'
function storedNumber(): string {
  try {
    return localStorage.getItem(NUMBER_KEY) ?? ''
  } catch {
    return ''
  }
}
function storeNumber(n: string): void {
  try {
    localStorage.setItem(NUMBER_KEY, n)
  } catch {
    // Not remembered; the card still prints with what was typed.
  }
}
/* Digits, spaces, hyphens and a leading +, with at least five digits. */
const isNumber = (n: string) => /^\+?[\d -]+$/.test(n.trim()) && (n.match(/\d/g) ?? []).length >= 5

/*
 * The SMS card for one patient, ready to print. It opens in the language
 * the patient reads and can be switched. A draft translation says so
 * before anyone prints it, on screen and on the paper. A patient SMS
 * would refuse gets no card: the page says why instead. The card cannot
 * be printed without the number patients send to.
 */
export function SmsCardPage() {
  const { patientId } = useParams() as { patientId: string }
  const patients = useQuery({ queryKey: ['patients'], queryFn: api.patients })
  const checklist = useQuery({ queryKey: ['checklist', patientId], queryFn: () => api.checklist(patientId) })
  const patient = patients.data?.find((p) => p.id === patientId)
  const [chosen, setChosen] = useState<CardLang | null>(null)
  const [number, setNumber] = useState(storedNumber)
  const [numberMissing, setNumberMissing] = useState(false)
  const numberField = useRef<HTMLInputElement>(null)
  const lang = chosen ?? (CARD_LANGS.find((l) => l === patient?.preferred_language) ?? 'en')
  useTitle(en.smsCard.title, patient?.full_name)

  const failed = patients.isError || checklist.isError
  const retry = () => [patients, checklist].forEach((q) => q.isError && void q.refetch())
  const active = checklist.data?.active

  function print() {
    if (!isNumber(number)) {
      setNumberMissing(true)
      numberField.current?.focus()
      return
    }
    window.print()
  }

  return (
    <main className={`${PAGE} pt-6 pb-16 print:p-0`}>
      <div className="print:hidden">
        <Link to={`/patients/${patientId}/checklist`} className="text-sm text-ink-2 underline-offset-4 hover:text-ink hover:underline">
          {patient ? `${en.smsCard.back}: ${patient.full_name}` : en.smsCard.back}
        </Link>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight">{en.smsCard.title}</h1>
        <p className="mt-1 max-w-[60ch] text-ink-2">{en.smsCard.intro}</p>
      </div>

      {failed && (
        <LoadError className="mt-8" message={en.smsCard.loadFailed} onRetry={retry} retrying={patients.isFetching || checklist.isFetching} />
      )}
      {!failed && (!patient || !checklist.data) && (
        patients.isSuccess && !patient
          ? <p className="mt-8 text-ink-2">{en.record.notFound}</p>
          : <div className="mt-8 h-[40rem] max-w-[37rem] rounded-xl bg-sunken" aria-busy="true" />
      )}

      {patient && checklist.data && !patient.sms_phone_last4 && (
        <p role="status" className="mt-8 max-w-[65ch] rounded-xl border border-line-strong bg-surface px-5 py-4">
          {fmt(en.smsCard.noSms, { name: patient.full_name })}
        </p>
      )}

      {patient && checklist.data && patient.sms_phone_last4 && (
        <>
          <div className="mt-6 flex flex-wrap items-start gap-x-6 gap-y-4 print:hidden">
            <div className="w-full max-w-64">
              <label htmlFor="sms-number" className="label mb-1.5 block">{en.smsCard.number}</label>
              <input
                id="sms-number"
                ref={numberField}
                type="tel"
                inputMode="tel"
                autoComplete="off"
                value={number}
                onChange={(e) => {
                  setNumber(e.target.value)
                  storeNumber(e.target.value.trim())
                  if (isNumber(e.target.value)) setNumberMissing(false)
                }}
                aria-invalid={numberMissing || undefined}
                aria-describedby="sms-number-help"
                className="numerals h-9 w-full rounded-lg border border-line-strong bg-surface px-3 font-mono text-sm aria-invalid:border-ink aria-invalid:border-2"
              />
              <p id="sms-number-help" className={`mt-1.5 text-xs ${numberMissing ? 'font-medium text-ink' : 'text-ink-3'}`}>
                {numberMissing ? en.smsCard.numberNeeded : en.smsCard.numberHint}
              </p>
            </div>
            <fieldset>
              <legend className="label mb-1.5">{en.smsCard.language}</legend>
              <div className="inline-flex rounded-lg border border-line-strong bg-surface p-1">
                {CARD_LANGS.map((l) => (
                  <label key={l}>
                    <input type="radio" name="card-lang" value={l} checked={lang === l} onChange={() => setChosen(l)} className="peer sr-only" />
                    <span
                      lang={l}
                      className={`${LANG_FONT[l]} block cursor-pointer rounded-md px-3 py-1 text-sm leading-6 text-ink-2 peer-checked:bg-accent-soft peer-checked:font-medium peer-checked:text-ink peer-focus-visible:outline-2 peer-focus-visible:outline-offset-1 peer-focus-visible:outline-accent hover:text-ink`}
                    >
                      {CARD[l].langName}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-col gap-1.5">
              {/* Lines the button up with the fields beside it, which have labels. */}
              <span aria-hidden className="label">&nbsp;</span>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <button
                  type="button"
                  onClick={print}
                  className="inline-flex h-9 items-center rounded-lg border border-accent bg-accent px-3.5 text-sm font-medium text-accent-ink hover:bg-accent-hover"
                >
                  {en.smsCard.print}
                </button>
                <p className="text-sm text-ink-3">{en.smsCard.printHint}</p>
              </div>
            </div>
          </div>
          {/* Announced when the language changes, so a draft is never chosen unknowingly. */}
          <div aria-live="polite" className="print:hidden">
            {!REVIEWED[lang] && (
              <p role="note" className="mt-4 max-w-[65ch] rounded-lg border border-line-strong bg-surface px-4 py-3 text-sm">
                {fmt(en.smsCard.draft, { language: en.entries.languages[lang] })}
              </p>
            )}
          </div>
          <div className="mt-6 print:mt-0">
            <SmsCard
              lang={lang}
              name={patient.full_name}
              reg={patient.registration_no}
              last4={patient.sms_phone_last4}
              sendTo={isNumber(number) ? number.trim() : ''}
              draft={!REVIEWED[lang]}
              medicines={active?.items ?? []}
              listDate={active?.activated_at ?? null}
            />
          </div>
        </>
      )}
    </main>
  )
}
