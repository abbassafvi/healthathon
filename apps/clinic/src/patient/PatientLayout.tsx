import { useQuery } from '@tanstack/react-query'
import { Link, NavLink, Outlet, useParams } from 'react-router'

import { api } from '../api/client'
import { en, fmt } from '../strings/en'

const PATIENT_TABS = [
  { path: 'checklist', label: en.patient.tabs.checklist },
  { path: 'documents', label: en.patient.tabs.documents },
] as const

/*
 * Everything about one patient sits under this header. The tabs are
 * sections of one record, not separate apps, so the header stays put.
 */
export function PatientLayout() {
  const { patientId } = useParams() as { patientId: string }
  const patients = useQuery({ queryKey: ['patients'], queryFn: api.patients })
  const patient = patients.data?.find((p) => p.id === patientId)

  if (patients.isSuccess && !patient) {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 pt-6 sm:px-6">
        <Link to="/patients" className="text-sm text-ink-2 underline-offset-4 hover:text-ink hover:underline">
          {en.record.backToPatients}
        </Link>
        <p className="mt-6 text-ink-2">{en.record.notFound}</p>
      </main>
    )
  }

  return (
    <>
      <div className="mx-auto w-full max-w-5xl px-4 pt-6 sm:px-6">
        <Link to="/patients" className="text-sm text-ink-2 underline-offset-4 hover:text-ink hover:underline">
          {en.record.backToPatients}
        </Link>
        <header className="mt-3 flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {/* A non-breaking space holds the line height while loading. */}
            {patient?.full_name ?? '\u00a0'}
          </h1>
          {patient && (
            <>
              <span className="font-mono text-sm text-ink-2">{patient.registration_no}</span>
              {patient.year_of_birth && (
                <span className="text-sm text-ink-2">{fmt(en.record.born, { year: patient.year_of_birth })}</span>
              )}
            </>
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
