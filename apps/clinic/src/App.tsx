import { Navigate, Route, Routes } from 'react-router'

import { AppShell } from './app/AppShell'
import { ConfirmQueuePage } from './confirm-queue/ConfirmQueuePage'
import { PatientsPage } from './record/PatientsPage'
import { RecordPage } from './record/RecordPage'
import { TracePanel } from './trace/TracePanel'

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/queue" replace />} />
        <Route path="queue" element={<ConfirmQueuePage />} />
        <Route path="patients" element={<PatientsPage />} />
        <Route path="patients/:patientId" element={<RecordPage />}>
          <Route path="values/:valueId" element={<TracePanel />} />
        </Route>
        <Route path="*" element={<Navigate to="/queue" replace />} />
      </Route>
    </Routes>
  )
}
