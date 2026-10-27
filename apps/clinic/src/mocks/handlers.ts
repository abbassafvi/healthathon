import { checklistHandlers } from './handlers/checklist'
import { entriesHandlers } from './handlers/entries'
import { paperFormHandlers } from './handlers/paperForm'
import { uploadHandlers } from './handlers/upload'
import { visitHandlers } from './handlers/visit'

/* What the browser mocks: only upload, whose reading pipeline is Track A's. */
export const browserHandlers = [...uploadHandlers]

/*
 * Every handler, for Vitest screen tests. The ones the browser no longer
 * uses are fixtures now: they follow the real API's contract (their types
 * come from the generated schema), and the API's own tests in api/tests
 * are what define the behaviour.
 */
export const handlers = [
  ...checklistHandlers,
  ...entriesHandlers,
  ...visitHandlers,
  ...paperFormHandlers,
  ...uploadHandlers,
]
