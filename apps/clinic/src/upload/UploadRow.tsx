import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'

import { api, type UploadDocType, type UploadStatus } from '../api/client'
import { en, fmt } from '../strings/en'
import { docTypeLabel } from './docTypeLabel'

export type SessionUpload = {
  key: string
  file: File
  preview: string
  patientId: string
  patientName: string
  docType: UploadDocType
  first: UploadStatus
}

const STAGES = ['uploading', 'reading', 'done'] as const

/* One uploaded photograph, polled until it has been read, then where its values went. */
export function UploadRow({ u, onRetry }: { u: SessionUpload; onRetry: () => void }) {
  const status = useQuery({
    queryKey: ['upload', u.first.id],
    queryFn: () => api.uploadStatus(u.first.id),
    initialData: u.first,
    refetchInterval: (q) => (['uploading', 'reading'].includes(q.state.data?.stage ?? '') ? 500 : false),
  })
  const s = status.data
  const reached = STAGES.indexOf(s.stage as (typeof STAGES)[number])

  return (
    <li className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-4 border-b border-line py-4" data-upload-stage={s.stage}>
      <img src={u.preview} alt="" className="aspect-[3/4] w-full rounded-md border border-line object-cover" />
      <div className="min-w-0">
        <p className="truncate text-sm font-medium">{u.file.name}</p>
        <p className="text-sm text-ink-2">
          {u.patientName}, {docTypeLabel(u.docType)}
        </p>
        {s.stage !== 'duplicate' && s.stage !== 'failed' && u.docType !== 'survey_form' && (
          <ol className="mt-2 flex gap-4 text-xs" aria-label={en.upload.stages[s.stage] ?? s.stage}>
            {STAGES.map((stage, i) => (
              <li key={stage} className={`flex items-center gap-1.5 ${i <= reached ? 'text-ink' : 'text-ink-3'}`} aria-current={i === reached ? 'step' : undefined}>
                <span aria-hidden className={`size-2 rounded-full ${i < reached || s.stage === 'done' ? 'bg-ink' : i === reached ? 'animate-pulse bg-accent motion-reduce:animate-none' : 'border border-line-strong'}`} />
                {en.upload.stages[stage]}
              </li>
            ))}
          </ol>
        )}
        <div aria-live="polite" className="mt-2 text-sm">
          {s.stage === 'done' && s.outcome && u.docType === 'survey_form' && (
            <>
              <p>{en.upload.surveyDone}</p>
              <p className="mt-2">
                <Link className="font-medium text-accent underline-offset-4 hover:underline" to={`/patients/${u.patientId}/documents`}>{en.upload.openSurveys}</Link>
              </p>
            </>
          )}
          {s.stage === 'done' && s.outcome && u.docType !== 'survey_form' && (
            <>
              {s.outcome.regimen_id ? (
                <p>{en.upload.rxDone}</p>
              ) : u.docType === 'prescription' ? null : (
                <>
                  <p>{fmt(en.upload.labDone, { n: s.outcome.values_in_record })}</p>
                  {s.outcome.sent_to_queue.map((q) => (
                    <p key={q.reason}>{fmt(en.upload.queued, { n: q.count, reason: en.reasons[q.reason as keyof typeof en.reasons] ?? q.reason })}</p>
                  ))}
                </>
              )}
              <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                {s.outcome.regimen_id ? (
                  <Link className="font-medium text-accent underline-offset-4 hover:underline" to={`/patients/${u.patientId}/checklist/review/${s.outcome.regimen_id}`}>{en.upload.review}</Link>
                ) : u.docType === 'prescription' ? (
                  <Link className="font-medium text-accent underline-offset-4 hover:underline" to={`/patients/${u.patientId}/checklist`}>{en.visit.openChecklist}</Link>
                ) : (
                  <>
                    <Link className="font-medium text-accent underline-offset-4 hover:underline" to={`/patients/${u.patientId}/documents`}>{en.upload.openRecord}</Link>
                    {s.outcome.sent_to_queue.length > 0 && (
                      <Link className="font-medium text-accent underline-offset-4 hover:underline" to="/queue">{en.upload.openQueue}</Link>
                    )}
                  </>
                )}
              </p>
            </>
          )}
          {s.stage === 'duplicate' && <p>{en.upload.duplicate}</p>}
          {s.stage === 'failed' && (
            <p className="flex flex-wrap items-center gap-3">
              <span>{fmt(en.upload.failed, { reason: s.failure ?? '' })}</span>
              <button type="button" onClick={onRetry} className="rounded-lg border border-line-strong bg-surface px-3 py-1 text-sm font-medium hover:bg-bg">{en.upload.retry}</button>
            </p>
          )}
        </div>
      </div>
    </li>
  )
}
