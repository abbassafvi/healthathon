import { render } from '@testing-library/react-native'
import type { ReactElement } from 'react'

import { AppStateProvider } from '../AppState'
import { createMockApi } from '../data/mockApi'

/* Renders inside the app state with a fresh mock API and a fixed clock. */
export function renderApp(ui: ReactElement, now = new Date('2026-10-26T09:00:00')) {
  const api = createMockApi(() => now)
  return { api, ...render(<AppStateProvider api={api}>{ui}</AppStateProvider>) }
}
