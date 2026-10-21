import { Navigate, Route, Routes } from 'react-router'

import { AppShell } from './app/AppShell'
import { ChecklistPage } from './checklist/ChecklistPage'
import { ReviewPage } from './checklist/ReviewPage'
import { ConfirmQueuePage } from './confirm-queue/ConfirmQueuePage'
import { PatientLayout } from './patient/PatientLayout'
import { PatientsPage } from './record/PatientsPage'
import { RecordPage } from './record/RecordPage'
import { TimelinePage } from './timeline/TimelinePage'
import { VisitPage } from './visit/VisitPage'
import { TracePanel } from './trace/TracePanel'

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<Navigate to="/queue" replace />} />
        <Route path="queue" element={<ConfirmQueuePage />} />
        <Route path="patients" element={<PatientsPage />} />
        <Route path="patients/:patientId/checklist/review/:regimenId" element={<ReviewPage />} />
        <Route path="patients/:patientId" element={<PatientLayout />}>
          <Route index element={<Navigate to="visit" replace />} />
          <Route path="visit" element={<VisitPage />} />
          <Route path="timeline" element={<TimelinePage />} />
          <Route path="checklist" element={<ChecklistPage />} />
          <Route path="documents" element={<RecordPage />}>
            <Route path="values/:valueId" element={<TracePanel />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/queue" replace />} />
      </Route>
    </Routes>
  )
}
