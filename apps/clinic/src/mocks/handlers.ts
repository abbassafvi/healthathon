import { checklistHandlers } from './handlers/checklist'
import { entriesHandlers } from './handlers/entries'

export const handlers = [...checklistHandlers, ...entriesHandlers]
