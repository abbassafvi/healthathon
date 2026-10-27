import { Link } from 'react-router'

import type { RecordDocument } from '../api/client'
import type { Checklist, TestOrder } from '../api/client'
import { formatDate } from '../lib/dates'
import { en, fmt } from '../strings/en'

type Props = { patientId: string; documents: RecordDocument[]; orders: TestOrder[]; checklist: Checklist | undefined }

export function DocumentsHalf({ patientId, documents, orders, checklist }: Props) {
  return (
    <div className="flex flex-col gap-8">
      <Block title={en.visit.labValues}>
        {documents.length === 0 ? (
          <p className="text-sm text-ink-2">{en.visit.noValues}</p>
        ) : (
          documents.map((d) => (
            <div key={d.id} className="mb-4 last:mb-0">
              <p className="text-sm">
                <span className="font-medium">{en.docTypes[d.doc_type] ?? en.docTypes.other}</span>
                <span className="numerals text-ink-2">, {d.document_date ? formatDate(d.document_date) : en.queue.noDate}</span>
                {d.issuing_source && <span className="text-ink-3">, {d.issuing_source}</span>}
              </p>
              <ul className="mt-1 border-t border-line">
                {d.values.map((v) => (
                  <li key={v.id} className="border-b border-line">
                    <Link
                      to={`/patients/${patientId}/documents/values/${v.id}`}
                      className="-mx-2 grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 rounded-md px-2 py-2 hover:bg-surface"
                    >
                      <span className="text-sm">{v.analyte_name}</span>
                      <span className="numerals">
                        <span className="text-lg font-semibold">{v.value_text}</span>{' '}
                        <span className="text-sm text-ink-3">{v.unit_text}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </Block>
      {orders.length > 0 && (
        <Block title={en.visit.orders}>
          <ul className="border-t border-line">
            {orders.map((o) => (
              <li key={o.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-3 border-b border-line py-2" data-order-matched={o.matched_value_id ? 'yes' : 'no'}>
                <span className="text-sm">
                  {o.analyte_name} <span className="text-ink-3">{fmt(en.visit.orderedOn, { date: formatDate(o.ordered_on) })}</span>
                </span>
                {/* An order with no report is a blank space, stated as a fact about the record. */}
                <span className="text-sm text-ink-3">{o.matched_value_id ? en.visit.matched : en.visit.noMatch}</span>
              </li>
            ))}
          </ul>
        </Block>
      )}
      <Block title={en.visit.checklist}>
        <p className="text-sm text-ink-2">
          {checklist?.active
            ? fmt(en.visit.checklistActive, { count: checklist.active.items.length, date: formatDate(checklist.active.activated_at) })
            : en.visit.checklistNone}{' '}
          <Link to={`/patients/${patientId}/checklist`} className="font-medium text-accent underline-offset-4 hover:underline">
            {en.visit.openChecklist}
          </Link>
        </p>
      </Block>
    </div>
  )
}

export function Block({ title, aside, children }: { title: string; aside?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-label={title}>
      <h3 className="mb-2 flex items-baseline justify-between gap-3 text-sm font-semibold">
        {title}
        {aside && <span className="font-normal text-ink-3">{aside}</span>}
      </h3>
      {children}
    </section>
  )
}
