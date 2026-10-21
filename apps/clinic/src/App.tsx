import { Navigate, Route, Routes } from 'react-router'

import { AppShell } from './app/AppShell'
import { ConfirmQueuePage } from './confirm-queue/ConfirmQueuePage'

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/queue" replace />} />
        <Route path="queue" element={<ConfirmQueuePage />} />
        <Route path="*" element={<Navigate to="/queue" replace />} />
      </Route>
    </Routes>
  )
}
