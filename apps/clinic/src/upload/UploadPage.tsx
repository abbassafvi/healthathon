import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'

import { api, type UploadDocType } from '../api/client'
import { CameraCapture, cameraAvailable } from './CameraCapture'
import { useTitle } from '../app/useTitle'
import { en, fmt } from '../strings/en'
import { UploadRow, type SessionUpload } from './UploadRow'
import { PAGE } from '../app/page'

type Picked = { key: string; file: File; preview: string }
type DocType = UploadDocType

/* Send the photograph to be read. Called from event handlers only. */
async function uploadOne(p: Picked, pid: string, type: DocType, patientName: string): Promise<SessionUpload> {
  const first = await api.upload({
    client_capture_id: p.key,
    patient_id: pid,
    doc_type: type,
    captured_at: new Date(p.file.lastModified || Date.now()).toISOString(),
    file: p.file,
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
  // A patient's page links here with ?patient=<id>, so that patient comes chosen.
  const [params] = useSearchParams()
  const [patientId, setPatientId] = useState(() => params.get('patient') ?? '')
  useTitle(en.upload.title)
  const [docType, setDocType] = useState<DocType | ''>('')
  const [picked, setPicked] = useState<Picked[]>([])
  const [rejected, setRejected] = useState<string[]>([])
  const [session, setSession] = useState<SessionUpload[]>([])
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [over, setOver] = useState(false)
  const [camera, setCamera] = useState(false)
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

  /*
   * What the upload is still waiting for. A disabled control that does
   * not say why leaves a clinician clicking at a grey button with a
   * photograph already in front of them.
   */
  const missing: string[] = []
  if (!patientId) missing.push(en.upload.needPatient)
  if (!docType) missing.push(en.upload.needDocType)
  if (picked.length === 0) missing.push(en.upload.needPhoto)
  const stillNeeded =
    missing.length === 0
      ? null
      : fmt(en.upload.stillNeeded, {
          what:
            missing.length === 1
              ? missing[0]!
              : `${missing.slice(0, -1).join(', ')} and ${missing[missing.length - 1]}`,
        })

  return (
    <main className={`${PAGE} pt-8 pb-16`}>
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
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => input.current?.click()} aria-describedby="up-photos" className="inline-flex h-9 items-center rounded-lg border border-line-strong bg-bg px-3.5 text-sm font-medium hover:bg-sunken">
                  {en.upload.choose}
                </button>
                <button type="button" onClick={() => setCamera(true)} aria-describedby="up-photos" data-testid="open-camera" className="inline-flex h-9 items-center rounded-lg border border-line-strong bg-bg px-3.5 text-sm font-medium hover:bg-sunken">
                  {en.upload.photograph}
                </button>
              </div>
              <span className="text-sm text-ink-2">{en.upload.dropHint}</span>
              <input ref={input} type="file" accept="image/*" capture="environment" multiple hidden data-testid="file-input"
                onChange={(e) => {
                  if (e.target.files) add(e.target.files)
                  e.target.value = ''
                }} />
            </div>
            {camera &&
              (cameraAvailable() ? (
                <CameraCapture onCapture={(file) => add([file])} onClose={() => setCamera(false)} />
              ) : (
                // getUserMedia needs a secure context: this page over plain
                // http from another machine cannot open a camera at all.
                <p role="alert" className="rounded-xl border border-line-strong bg-surface p-4 text-sm">
                  {en.upload.cameraInsecure}
                </p>
              ))}
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
          <div className="flex flex-col gap-2">
            <button type="submit" disabled={!ready} aria-describedby={stillNeeded ? 'up-needed' : undefined}
              className="inline-flex h-10 w-fit items-center rounded-lg border border-accent bg-accent px-4 text-sm font-medium text-accent-ink transition-colors duration-150 hover:bg-accent-hover disabled:cursor-not-allowed disabled:border-line disabled:bg-sunken disabled:text-ink-3">
              {picked.length > 1 ? fmt(en.upload.submitN, { n: picked.length }) : en.upload.submit}
            </button>
            {stillNeeded && (
              <p id="up-needed" aria-live="polite" className="text-sm text-ink-2">{stillNeeded}</p>
            )}
          </div>
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
