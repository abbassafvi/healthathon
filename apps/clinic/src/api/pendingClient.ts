import { request } from './client'
import type { UploadRequest, UploadStatus } from './pending'

/* Calls to endpoints served by the mock layer until they are built in api/. */
export const pendingApi = {
  upload: (req: UploadRequest) => request<UploadStatus>('/api/uploads', { method: 'POST', body: JSON.stringify(req) }),
  uploadStatus: (id: string) => request<UploadStatus>(`/api/uploads/${id}`),
}
