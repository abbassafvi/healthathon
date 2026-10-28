import '@fontsource/noto-sans-devanagari/devanagari-400.css'
import '@fontsource/noto-sans-devanagari/devanagari-700.css'
import '@fontsource/noto-nastaliq-urdu/arabic-400.css'
import '@fontsource/noto-nastaliq-urdu/arabic-700.css'

import type { RegimenItem } from '../api/client'
import { en, fmt } from '../strings/en'
import { CARD, cardDate, WHEN_LETTERS, type CardLang } from './cardStrings'

type Medicine = Pick<RegimenItem, 'id' | 'drug_text' | 'dose_text' | 'schedule_text'>

/* Each script in its own face; Nastaliq needs far more line height. */
const SCRIPT: Record<CardLang, string> = {
  en: 'font-sans leading-normal',
  hi: 'font-deva leading-relaxed',
  ur: 'font-urdu leading-[2.1]',
}

/*
 * The card a patient keeps by the phone. On screen it is one column;
 * printed, it fills one A4 sheet in two columns, so a long medicine list
 * or Urdu's taller lines still fit on one page. Medicines are
 * numbered in checklist order, the order the SMS reader counts them in.
 * The codes and the medicines as printed stay in Latin letters, left to
 * right, inside a Hindi or Urdu card. Nothing on it is a target or a
 * judgement: the one number shown is labelled as an example.
 */
export function SmsCard({ lang, name, reg, last4, sendTo, draft, medicines, listDate }: {
  lang: CardLang
  name: string
  reg: string
  last4: string
  /* The clinic's SMS number; a blank line to write on when there is none. */
  sendTo: string
  /* An unreviewed translation says so on the paper, in English, for the staff. */
  draft: boolean
  medicines: Medicine[]
  listDate: string | null
}) {
  const s = CARD[lang]
  const codes = ['G 142 F', ...medicines.slice(0, 2).map((_, i) => `T ${i + 1} Y`)]
  // The answer is the patient's own words, so it is set in their script, not the code face.
  const answer = <>Q <span className={SCRIPT[lang]}>{s.answer.example}</span></>

  return (
    <article
      lang={lang}
      dir={lang === 'ur' ? 'rtl' : 'ltr'}
      aria-label={s.title}
      data-testid="sms-card"
      className={`${SCRIPT[lang]} w-full max-w-[37rem] rounded-xl border border-line bg-surface p-6 text-[0.9375rem] text-ink sm:p-8 print:max-w-none print:rounded-none print:border-0 print:p-0 print:text-[11pt]`}
    >
      {draft && (
        <p lang="en" dir="ltr" className="mb-4 rounded-md border-2 border-ink px-3 py-1.5 font-sans text-sm leading-snug font-semibold">
          {en.smsCard.draftMark}
        </p>
      )}
      <header className="flex items-center justify-between gap-4 border-b border-line pb-3">
        <span dir="ltr" className="flex items-center gap-2 font-sans text-sm font-semibold tracking-tight">
          <CardMark />
          cliniConnect
        </span>
        <span className="text-sm text-ink-2">{fmt(s.owner, { name, reg })}</span>
      </header>

      <h2 className="mt-4 text-2xl font-bold tracking-tight">{s.title}</h2>
      <div className="print:columns-2 print:gap-x-[10mm]">
        <div className="break-inside-avoid">
          <div className="mt-4">
            <p className="font-semibold">{s.sendTo}</p>
            {sendTo ? (
              <p className="mt-1 text-2xl font-semibold"><span dir="ltr" className="font-card-mono" data-testid="sms-number">{sendTo}</span></p>
            ) : (
              // Left blank for the clinic to write its number in.
              <div aria-hidden className="mt-7 border-b border-ink" />
            )}
          </div>
          <p className="mt-3">{fmt(s.from, { last4 })}</p>
          <p className="mt-2 text-ink-2">{s.howTo}</p>
        </div>

        <Part title={s.reading.title} code="G 142 F">
          <p>{s.reading.how}</p>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 print:grid-cols-2">
            {WHEN_LETTERS.map((l) => (
              <div key={l} className="flex items-center gap-2">
                <dt><Key>{l}</Key></dt>
                <dd>{s.reading.when[l]}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-ink-2">{s.reading.needLetter} {s.reading.example}</p>
        </Part>

        <Part title={s.medicine.title} code="T 1 Y">
          <p>{s.medicine.how}</p>
          {medicines.length > 0 && listDate ? (
            <>
              <p className="mt-3 font-semibold">{fmt(s.medicine.list, { date: cardDate(listDate, s) })}</p>
              <ol className="mt-2 flex flex-col gap-2" aria-label={s.medicine.title}>
                {medicines.map((m, i) => (
                  <li key={m.id} className="flex items-center gap-3">
                    <Key>{i + 1}</Key>
                    <span dir="ltr" className="flex flex-wrap items-baseline gap-x-2.5 font-sans leading-normal">
                      <span className="font-semibold">{m.drug_text}</span>
                      <span className="numerals">{m.dose_text}</span>
                      {m.schedule_text && <span className="numerals font-mono text-sm text-ink-2">{m.schedule_text}</span>}
                    </span>
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-ink-2">{s.medicine.change}</p>
            </>
          ) : (
            <p className="mt-3 text-ink-2">{s.medicine.none}</p>
          )}
        </Part>

        <Part title={s.answer.title} code={answer}>
          <p>{s.answer.how}</p>
        </Part>

        <section className="mt-6 break-inside-avoid">
          <h3 className="font-semibold">{s.exampleTitle}</h3>
          <div dir="ltr" data-testid="sms-example" className="font-card-mono mt-2 rounded-lg bg-sunken px-4 py-3 text-base leading-relaxed print:border print:border-line-strong print:bg-transparent">
            {codes.map((c) => <div key={c} className="whitespace-pre">{c}</div>)}
            <div>{answer}</div>
          </div>
        </section>

        <footer className="mt-6 flex break-inside-avoid flex-col gap-1.5 border-t border-line pt-3 text-ink-2">
          <p>{s.noReply}</p>
          <p className="font-semibold text-ink">{s.notAdvice}</p>
        </footer>
      </div>
    </article>
  )
}

function Part({ title, code, children }: { title: string; code: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="mt-6 break-inside-avoid border-t border-line pt-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <h3 className="text-lg font-semibold">{title}</h3>
        <code dir="ltr" className="font-card-mono rounded-lg border-2 border-ink px-3 py-1 text-lg font-semibold whitespace-pre-wrap">{code}</code>
      </div>
      <div className="mt-2">{children}</div>
    </section>
  )
}

/* A letter or number the patient types, drawn as a key. */
function Key({ children }: { children: React.ReactNode }) {
  return (
    <span dir="ltr" className="inline-grid size-8 shrink-0 place-items-center rounded-md border border-ink font-mono text-base font-semibold leading-none">
      {children}
    </span>
  )
}

/* The patient app's mark in ink, so it prints on any printer: a calendar page with today's dot. */
function CardMark() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className="size-5">
      <rect x="1" y="1" width="22" height="22" rx="6" fill="none" stroke="currentColor" strokeWidth="2" />
      <rect x="6" y="6.5" width="12" height="11" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.75" />
      <circle cx="12" cy="12.5" r="1.75" fill="currentColor" />
    </svg>
  )
}
