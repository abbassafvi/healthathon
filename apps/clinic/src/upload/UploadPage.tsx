import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'

import { api } from '../api/client'
import { pendingApi } from '../api/pendingClient'
import { en, fmt } from '../strings/en'
import { sha256Hex } from './sha256'
import { UploadRow, type SessionUpload } from './UploadRow'

type Picked = { key: string; file: File; preview: string }
type DocType = 'prescription' | 'lab_report'

/* Hash the photograph and register the upload. Called from event handlers only. */
async function uploadOne(p: Picked, pid: string, type: DocType, patientName: string): Promise<SessionUpload> {
  const first = await pendingApi.upload({
    client_capture_id: p.key,
    patient_id: pid,
    doc_type: type,
    file_name: p.file.name,
    sha256: await sha256Hex(p.file),
    captured_at: new Date(p.file.lastModified || Date.now()).toISOString(),
  })
  return { key: p.key, file: p.file, preview: p.preview, patientId: pid, patientName, docType: type, first }
}

/*
 * Photographs in, documents out. Each photograph gets a capture id when it
 * is picked, which is the idempotency key end to end, and a hash, which is
 * how a photograph already in the patient's record is recognised.
 */
export function UploadPage() {
  const patients = useQuery({ queryKey: ['patients'], queryFn: api.patients })
  const [patientId, setPatientId] = useState('')
  const [docType, setDocType] = useState<DocType | ''>('')
  const [picked, setPicked] = useState<Picked[]>([])
  const [rejected, setRejected] = useState<string[]>([])
  const [session, setSession] = useState<SessionUpload[]>([])
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const urls = useRef<string[]>([])

  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), [])

  const add = (files: FileList | File[]) => {
    const list = [...files]
    setRejected(list.filter((f) => !f.type.startsWith('image/')).map((f) => f.name))
    const next = list.filter((f) => f.type.startsWith('image/')).map((file) => {
      const preview = URL.createObjectURL(file)
      urls.current.push(preview)
      return { key: crypto.randomUUID(), file, preview }
    })
    setPicked((p) => [...p, ...next])
  }

  const nameOf = (pid: string) => patients.data?.find((x) => x.id === pid)?.full_name ?? ''
  const send = (p: Picked, pid: string, type: DocType) => uploadOne(p, pid, type, nameOf(pid))

  const submit = async () => {
    if (!patientId || !docType || picked.length === 0) return
    setBusy(true)
    setFailed(false)
    try {
      const done = await Promise.all(picked.map((p) => send(p, patientId, docType)))
      setSession((s) => [...done, ...s])
      setPicked([])
    } catch {
      // Nothing was added to the session; the photographs stay picked for a retry.
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  const retry = async (u: SessionUpload) => {
    // A retry is a new capture of the same photograph.
    const again = await send({ key: crypto.randomUUID(), file: u.file, preview: u.preview }, u.patientId, u.docType)
    setSession((s) => s.map((x) => (x.key === u.key ? again : x)))
  }

  const ready = !!patientId && !!docType && picked.length > 0 && !busy

  return (
    <main className="mx-auto w-full max-w-6xl px-4 pt-8 pb-16 sm:px-6">
      <h1 className="text-2xl font-semibold tracking-tight">{en.upload.title}</h1>
      <p className="mt-2 inline-block rounded-lg border border-line-strong bg-surface px-3 py-1.5 text-sm">{en.upload.fictionalOnly}</p>

      <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)]">
        <form
          className="flex flex-col gap-6"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="flex flex-col gap-1.5">
            <label htmlFor="up-patient" className="label">{en.upload.patient}</label>
            <select id="up-patient" value={patientId} onChange={(e) => setPatientId(e.target.value)} className="h-10 rounded-lg border border-line-strong bg-surface px-3">
              <option value="">{en.upload.choosePatient}</option>
              {patients.data?.map((p) => (
                <option key={p.id} value={p.id}>{p.full_name} ({p.registration_no})</option>
              ))}
            </select>
          </div>

          <fieldset className="flex flex-col gap-2">
            <legend className="label mb-1.5">{en.upload.docType}</legend>
            <div className="flex gap-2">
              {(['prescription', 'lab_report'] as const).map((t) => (
                <label key={t} className="flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-line-strong bg-surface px-3.5 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent">
                  <input type="radio" name="doc-type" value={t} checked={docType === t} onChange={() => setDocType(t)} className="sr-only" />
                  {t === 'prescription' ? en.upload.prescription : en.upload.labReport}
                </label>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-col gap-2">
            <span id="up-photos" className="label">{en.upload.photos}</span>
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setOver(true)
              }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setOver(false)
                add(e.dataTransfer.files)
              }}
              className={`flex flex-col items-start gap-2 rounded-xl border-2 border-dashed px-4 py-5 transition-colors duration-150 ${over ? 'border-accent bg-accent-soft' : 'border-line-strong bg-surface'}`}
            >
              <button type="button" onClick={() => input.current?.click()} aria-describedby="up-photos" className="inline-flex h-9 items-center rounded-lg border border-line-strong bg-bg px-3.5 text-sm font-medium hover:bg-sunken">
                {en.upload.choose}
              </button>
              <span className="text-sm text-ink-2">{en.upload.dropHint}</span>
              <input ref={input} type="file" accept="image/*" capture="environment" multiple hidden data-testid="file-input"
                onChange={(e) => {
                  if (e.target.files) add(e.target.files)
                  e.target.value = ''
                }} />
            </div>
            {rejected.map((n) => <p key={n} role="alert" className="text-sm">{fmt(en.upload.notImage, { name: n })}</p>)}
            {picked.length > 0 && (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-3">
                {picked.map((p) => (
                  <li key={p.key} className="relative">
                    <img src={p.preview} alt={p.file.name} className="aspect-[3/4] w-full rounded-md border border-line object-cover" />
                    <button type="button" onClick={() => setPicked((x) => x.filter((y) => y.key !== p.key))}
                      className="absolute top-1 right-1 grid size-7 place-items-center rounded-full border border-line-strong bg-surface text-sm">
                      <span aria-hidden>×</span>
                      <span className="sr-only">{fmt(en.upload.remove, { name: p.file.name })}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {failed && <p role="alert" className="text-sm">{en.upload.startFailed}</p>}
          <button type="submit" disabled={!ready}
            className="inline-flex h-10 w-fit items-center rounded-lg border border-accent bg-accent px-4 text-sm font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-hover disabled:cursor-not-allowed disabled:border-line disabled:bg-sunken disabled:text-ink-3">
            {picked.length > 1 ? fmt(en.upload.submitN, { n: picked.length }) : en.upload.submit}
          </button>
        </form>

        <section aria-labelledby="up-session">
          <h2 id="up-session" className="border-b border-line pb-2 text-base font-semibold">{en.upload.session}</h2>
          {session.length === 0 ? (
            <p className="mt-4 max-w-[52ch] text-sm text-ink-2">{en.upload.sessionEmpty}</p>
          ) : (
            <ul>{session.map((u) => <UploadRow key={u.key} u={u} onRetry={() => void retry(u)} />)}</ul>
          )}
        </section>
      </div>
    </main>
  )
}
