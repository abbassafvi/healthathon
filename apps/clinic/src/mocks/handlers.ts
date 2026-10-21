import { checklistHandlers } from './handlers/checklist'
import { entriesHandlers } from './handlers/entries'
import { visitHandlers } from './handlers/visit'

export const handlers = [...checklistHandlers, ...entriesHandlers, ...visitHandlers]
