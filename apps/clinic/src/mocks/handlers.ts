import { checklistHandlers } from './handlers/checklist'
import { entriesHandlers } from './handlers/entries'
import { paperFormHandlers } from './handlers/paperForm'
import { uploadHandlers } from './handlers/upload'
import { visitHandlers } from './handlers/visit'

export const handlers = [
  ...checklistHandlers,
  ...entriesHandlers,
  ...visitHandlers,
  ...paperFormHandlers,
  ...uploadHandlers,
]
