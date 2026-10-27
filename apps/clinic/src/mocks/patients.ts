/*
 * Mock handlers are keyed by registration number; the URLs carry patient
 * ids from the real API. In the browser the lookup goes to the real
 * /api/patients (bypassing the mock layer); tests install a fixed list.
 */
export type PatientRef = { id: string; registration_no: string; full_name: string }
type Lookup = () => Promise<PatientRef[]>

let lookup: Lookup = async () => []

export function setPatientLookup(fn: Lookup): void {
  lookup = fn
}

export async function patientById(id: string): Promise<PatientRef | undefined> {
  return (await lookup()).find((p) => p.id === id)
}

export async function patientByRegistration(reg: string): Promise<PatientRef | undefined> {
  return (await lookup()).find((p) => p.registration_no === reg)
}
