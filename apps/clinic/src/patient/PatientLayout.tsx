import { useQuery } from '@tanstack/react-query'
import { Fragment } from 'react'
import { Link, NavLink, Outlet, useLocation, useParams } from 'react-router'

import { api, type PatientListItem } from '../api/client'
import { BUTTON, PAGE } from '../app/page'
import { useTitle } from '../app/useTitle'
import { formatBooked, formatDate } from '../lib/dates'
import { en, fmt } from '../strings/en'

const PATIENT_TABS = [
  { path: 'visit', label: en.patient.tabs.visit },
  { path: 'timeline', label: en.patient.tabs.timeline },
  { path: 'checklist', label: en.patient.tabs.checklist },
  { path: 'documents', label: en.patient.tabs.documents },
  { path: 'paper-form', label: en.patient.tabs.paperForm },
] as const

/*
 * Everything about one patient sits under this header. The tabs are
 * sections of one record, not separate apps, so the header stays put. It
 * says who the patient is and where their care stands in dates and
 * counts: the next and last visit, the checklist in force. Nothing in it
 * judges the patient.
 */
export function PatientLayout() {
  const { patientId } = useParams() as { patientId: string }
  const { pathname } = useLocation()
  const patients = useQuery({ queryKey: ['patients'], queryFn: api.patients })
  const patient = patients.data?.find((p) => p.id === patientId)
  useTitle(section(pathname), patient?.full_name)

  if (patients.isSuccess && !patient) {
    return (
      <main className={`${PAGE} pt-6`}>
        <Link to="/patients" className="text-sm text-ink-2 underline-offset-4 hover:text-ink hover:underline">
          {en.record.backToPatients}
        </Link>
        <p className="mt-6 text-ink-2">{en.record.notFound}</p>
      </main>
    )
  }

  return (
    <>
      <div className={`${PAGE} pt-6`}>
        <Link to="/patients" className="text-sm text-ink-2 underline-offset-4 hover:text-ink hover:underline">
          {en.record.backToPatients}
        </Link>
        <header className="mt-3 flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <h1 className="text-2xl font-semibold tracking-tight">
                {/* A non-breaking space holds the line height while loading. */}
                {patient?.full_name ?? ' '}
              </h1>
              {patient && <span className="font-mono text-sm text-ink-2">{patient.registration_no}</span>}
            </div>
            {patient && <Facts p={patient} />}
          </div>
          {patient && (
            <Link to={`/upload?patient=${patient.id}`} className={BUTTON}>{en.patient.upload}</Link>
          )}
        </header>
        <nav aria-label={en.patient.tabsLabel} className="mt-5 flex gap-6 overflow-x-auto border-b border-line text-sm">
          {PATIENT_TABS.map((t) => (
            <NavLink
              key={t.path}
              to={t.path}
              className={({ isActive }) =>
                `-mb-px border-b-2 pb-2.5 whitespace-nowrap ${
                  isActive ? 'border-accent font-medium text-ink' : 'border-transparent text-ink-2 hover:text-ink'
                }`
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      </div>
      <Outlet />
    </>
  )
}

function Facts({ p }: { p: PatientListItem }) {
  const who = [
    p.year_of_birth && fmt(en.record.born, { year: p.year_of_birth }),
    p.sex && (en.patients.sexes[p.sex] ?? p.sex),
    fmt(en.patient.reads, { language: en.entries.languages[p.preferred_language] ?? p.preferred_language }),
    p.caregiver && (p.caregiver.relationship
      ? fmt(en.patient.caregiverAs, { name: p.caregiver.full_name, relationship: p.caregiver.relationship })
      : fmt(en.patient.caregiver, { name: p.caregiver.full_name })),
    fmt(en.patient.enrolled, { date: formatDate(p.enrolled_at) }),
  ].filter(Boolean)
  const facts: [string, React.ReactNode][] = [
    [en.patients.nextVisit, p.next_visit ? formatBooked(p.next_visit) : en.patients.noVisit],
    [en.patients.lastVisit, p.last_visit ? formatDate(p.last_visit) : en.patients.noVisit],
    [en.patients.checklist, p.checklist_since
      ? `${p.checklist_medicines === 1 ? en.patients.medicinesOne : fmt(en.patients.medicines, { n: p.checklist_medicines })}, ${fmt(en.patients.since, { date: formatDate(p.checklist_since) })}`
      : en.patients.noChecklist],
    [en.patient.sms, p.sms_phone_last4 ? (
      <Link key="sms" to={`/patients/${p.id}/sms-card`} className="inline-flex min-h-6 items-center text-accent underline-offset-4 hover:underline">
        {fmt(en.patient.smsFrom, { last4: p.sms_phone_last4 })}
      </Link>
    ) : en.patient.smsNone],
  ]
  return (
    <>
      <p className="numerals mt-1 flex flex-wrap gap-x-2 text-sm text-ink-2">
        {who.map((w, i) => (
          <Fragment key={i}>
            {i > 0 && <span aria-hidden className="text-ink-3">·</span>}
            <span>{w}</span>
          </Fragment>
        ))}
      </p>
      <dl aria-label={en.patient.facts} className="numerals mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        {facts.map(([term, value]) => (
          <div key={term} className="flex gap-1.5">
            <dt className="text-ink-2">{term}</dt>
            <dd className="font-medium">{value}</dd>
          </div>
        ))}
      </dl>
    </>
  )
}

/* The section the tab title names, from the address. */
function section(pathname: string): string {
  if (pathname.endsWith('/reading')) return en.reading.title
  if (pathname.includes('/documents/values/')) return en.trace.title
  return PATIENT_TABS.find((t) => pathname.split('/').includes(t.path))?.label ?? en.patient.tabs.visit
}
