import { checklistHandlers } from './handlers/checklist'
import { entriesHandlers } from './handlers/entries'
import { paperFormHandlers } from './handlers/paperForm'
import { visitHandlers } from './handlers/visit'

/*
 * Fixtures for the Vitest screen tests. Every clinician endpoint is real
 * now, so nothing here runs in the browser. They follow the real API's
 * contract (their types come from the generated schema), and the API's
 * own tests in api/tests are what define the behaviour.
 */
export const handlers = [
  ...checklistHandlers,
  ...entriesHandlers,
  ...visitHandlers,
  ...paperFormHandlers,
]
