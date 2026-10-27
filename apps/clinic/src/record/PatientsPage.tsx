import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'

import { api } from '../api/client'
import { en } from '../strings/en'
import { PAGE } from '../app/page'

export function PatientsPage() {
  const query = useQuery({ queryKey: ['patients'], queryFn: api.patients })

  return (
    <main className={`${PAGE} pt-8 pb-16`}>
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">{en.patients.title}</h1>
      {query.status === 'pending' && <div className="h-48 rounded-xl bg-sunken" aria-busy="true" />}
      {query.status === 'error' && <p className="text-ink-2">{en.patients.loadFailed}</p>}
      {query.status === 'success' && query.data.length === 0 && <p className="text-ink-2">{en.patients.empty}</p>}
      {query.status === 'success' && query.data.length > 0 && (
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b border-line">
              <th scope="col" className="label py-2 pr-6 font-normal">{en.patients.registrationNo}</th>
              <th scope="col" className="label py-2 pr-6 font-normal">{en.patients.name}</th>
              <th scope="col" className="label py-2 pr-6 font-normal">{en.patients.born}</th>
              <th scope="col" className="label py-2 font-normal">{en.patients.sex}</th>
            </tr>
          </thead>
          <tbody>
            {query.data.map((p) => (
              // The name's link stretches over the whole row, so a click anywhere opens the
              // patient while the row stays one link for the keyboard and screen readers.
              <tr key={p.id} className="group relative border-b border-line hover:bg-surface">
                <td className="py-3 pr-6 font-mono text-xs text-ink-2">{p.registration_no}</td>
                <td className="py-3 pr-6">
                  <Link
                    to={`/patients/${p.id}`}
                    className="font-medium text-ink underline-offset-4 after:absolute after:inset-0 after:content-[''] group-hover:underline"
                  >
                    {p.full_name}
                  </Link>
                </td>
                <td className="numerals py-3 pr-6 text-ink-2">{p.year_of_birth ?? ''}</td>
                <td className="py-3 text-ink-2">{p.sex ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  )
}
