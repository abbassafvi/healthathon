import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'

import { App } from './App'
import './index.css'

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: true, retry: 1 } },
})

// Endpoints that are not built yet are served by the mock layer in dev.
// e2e tests that intercept real requests switch it off (see e2e/mocks.ts).
const noMocks = (globalThis as { __NO_MOCKS?: boolean }).__NO_MOCKS === true
if (import.meta.env.DEV && import.meta.env.VITE_MOCKS !== 'off' && !noMocks) {
  const { startMocks } = await import('./mocks/browser')
  await startMocks()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
)
