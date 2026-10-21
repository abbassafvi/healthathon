import { useEffect, useRef, useState } from 'react'

import { en } from '../strings/en'
import { ActionButton } from './ActionButton'

type Props = {
  initialUnit: string | null
  onSave: (value: string, unit: string | null) => void
  onCancel: () => void
}

/*
 * The reviewer types the value as it appears on the page. It starts empty
 * on purpose: pre-filling the machine's reading invites editing it rather
 * than reading the crop.
 */
export function CorrectionForm({ initialUnit, onSave, onCancel }: Props) {
  const [value, setValue] = useState('')
  const [unit, setUnit] = useState(initialUnit ?? '')
  const valueRef = useRef<HTMLInputElement>(null)

  useEffect(() => valueRef.current?.focus(), [])

  const submit = () => {
    if (value.trim()) onSave(value.trim(), unit.trim() || null)
  }

  return (
    <form
      className="flex flex-wrap items-end gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          onCancel()
        }
      }}
    >
      <Field label={en.queue.correctionLabel} id="correction-value">
        <input
          ref={valueRef}
          id="correction-value"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          maxLength={200}
          className="numerals h-10 w-48 rounded-lg border border-line-strong bg-surface px-3 text-lg text-ink"
        />
      </Field>
      <Field label={en.queue.unitLabel} id="correction-unit">
        <input
          id="correction-unit"
          value={unit}
          onChange={(e) => setUnit(e.target.value)}
          autoComplete="off"
          spellCheck={false}
          maxLength={50}
          className="h-10 w-32 rounded-lg border border-line-strong bg-surface px-3 text-ink"
        />
      </Field>
      <ActionButton primary type="submit" kbd="Enter" disabled={!value.trim()} onClick={() => {}}>
        {en.queue.saveCorrection}
      </ActionButton>
      <ActionButton kbd="Esc" onClick={onCancel}>
        {en.queue.cancel}
      </ActionButton>
    </form>
  )
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children}
    </div>
  )
}
