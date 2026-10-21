import { useState } from 'react'

import { ActionButton } from '../confirm-queue/ActionButton'
import { en } from '../strings/en'

type Values = { drug_text: string; dose_text: string; schedule_text: string | null }

/*
 * The reviewer types the medicine as written. Fields start empty, as in
 * the confirm queue, so the crop is read rather than the machine's guess.
 */
export function ItemCorrectionForm({ onSave, onCancel }: { onSave: (v: Values) => void; onCancel: () => void }) {
  const [drug, setDrug] = useState('')
  const [dose, setDose] = useState('')
  const [schedule, setSchedule] = useState('')
  const ready = drug.trim() !== '' && dose.trim() !== ''

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (ready) onSave({ drug_text: drug.trim(), dose_text: dose.trim(), schedule_text: schedule.trim() || null })
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onCancel()
        }
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <Field id="fix-drug" label={en.review.drugLabel} value={drug} onChange={setDrug} autoFocus />
        <Field id="fix-dose" label={en.review.doseLabel} value={dose} onChange={setDose} />
        <Field id="fix-schedule" label={en.review.scheduleLabel} value={schedule} onChange={setSchedule} />
      </div>
      <div className="flex gap-2">
        <ActionButton primary type="submit" kbd="Enter" disabled={!ready} onClick={() => {}}>
          {en.review.save}
        </ActionButton>
        <ActionButton kbd="Esc" onClick={onCancel}>
          {en.review.cancel}
        </ActionButton>
      </div>
    </form>
  )
}

function Field(props: {
  id: string
  label: string
  value: string
  onChange: (v: string) => void
  autoFocus?: boolean
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={props.id} className="label">{props.label}</label>
      <input
        id={props.id}
        autoFocus={props.autoFocus}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        autoComplete="off"
        spellCheck={false}
        maxLength={120}
        className="h-10 min-w-0 rounded-lg border border-line-strong bg-surface px-3 text-ink"
      />
    </div>
  )
}
