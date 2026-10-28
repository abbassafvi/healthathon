import type { RegimenItem } from '../api/client'

/* A medicine exactly as printed: name, dose and schedule, nothing mapped. */
export function ItemText({ item, size = 'md' }: { item: Pick<RegimenItem, 'drug_text' | 'dose_text' | 'schedule_text'>; size?: 'md' | 'lg' }) {
  return (
    <p className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
      <span className={`font-semibold ${size === 'lg' ? 'text-xl' : 'text-base'}`}>{item.drug_text}</span>
      <span className="numerals text-ink">{item.dose_text}</span>
      {item.schedule_text && <span className="numerals font-mono text-sm text-ink-2">{item.schedule_text}</span>}
    </p>
  )
}
