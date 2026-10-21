/*
 * English interface strings for the clinic app. This file is frozen at the
 * end of week 2 and sent for translation, so every visible string lives
 * here. Placeholders use {name}.
 */
export const en = {
  app: {
    name: 'Consultation Readiness',
    navQueue: 'Confirm queue',
    signedInAs: 'Signed in as {name}',
  },
  queue: {
    title: 'Confirm queue',
    position: '{n} of {total}',
    patient: 'Patient',
    document: 'Document',
    reportDate: 'Dated',
    noDate: 'No date printed',
    test: 'Test',
    asRead: 'As read',
    reasonLabel: 'Why this is here',
    cropAlt: 'The region of the page this value was read from',
    cropLoading: 'Loading the image. Decisions unlock once it is on screen.',
    cropFailed: 'The image did not load, so this value cannot be settled yet.',
    retry: 'Try again',
    confirm: 'Confirm as read',
    useCandidate: 'Use {value}',
    correct: 'Type the value',
    discard: 'Not a value',
    correctionLabel: 'Value as it appears on the page',
    unitLabel: 'Unit',
    saveCorrection: 'Save',
    cancel: 'Cancel',
    undo: 'Undo',
    decidedConfirm: 'Confirmed {value}',
    decidedCorrect: 'Corrected to {value}',
    decidedDiscard: 'Marked not a value',
    alreadySettled: 'Someone else settled that item already.',
    saveFailed: 'That decision was not saved. The item is back in the queue.',
    emptyTitle: 'Nothing is waiting',
    emptyBody:
      'Values the reader cannot stand behind arrive here as documents are read, in the order they came in.',
    loadFailed: 'The queue could not be loaded.',
    keysHint: 'Keyboard',
  },
  reasons: {
    no_region_on_page: 'The reader could not point to where this value is on the page.',
    readers_disagree: 'Two readings of this region disagree.',
    conflicting_documents: 'Another document gives a different value for this test.',
    unknown_unit: 'The unit printed here is not one this test uses.',
    outside_assay_range: 'This value is outside what this test can report.',
    implausible_date: 'The date on this document does not look real.',
    region_illegible: 'This part of the image is hard to read.',
    handwritten: 'This value is handwritten.',
    script_not_read: 'This part is in a script the reader does not read.',
  },
  docTypes: {
    lab_report: 'Lab report',
    prescription: 'Prescription',
    discharge_summary: 'Discharge summary',
    imaging_report: 'Imaging report',
    referral_letter: 'Referral letter',
    register_sheet: 'Register sheet',
    other: 'Document',
  } as Record<string, string>,
} as const

export function fmt(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(values[key] ?? `{${key}}`))
}
