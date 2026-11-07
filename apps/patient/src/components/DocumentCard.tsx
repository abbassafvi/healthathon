import { Image, StyleSheet, View } from 'react-native'

import { useApp } from '../AppState'
import type { PatientDoc } from '../data/types'
import { color, radius, space } from '../theme'
import { Txt } from './Txt'

/*
 * One page on the record, and what was read off it, as written.
 *
 * Every reading says whether a clinician has checked it. That is the
 * whole point of the line: a reading nobody has checked is not a fact
 * about a medicine, and the app says so rather than letting the patient
 * read machine output as their prescription. The marker is words, never
 * a colour, because no colour in this app means good or bad.
 *
 * A laboratory number has no text at all until it is settled. That is
 * not this screen's choice: proj.renderable_value is the only view a
 * value may be read from, and it admits nothing unsettled.
 */
export function DocumentCard({ doc }: { doc: PatientDoc }) {
  const { t } = useApp()
  const when = new Date(doc.received_at)
  const nothingRead = !doc.lines.length && !doc.values.length && !doc.advice.length

  return (
    <View style={styles.card} testID={`doc-${doc.id}`}>
      <View style={styles.header}>
        <Txt size={20} weight="bold" accessibilityRole="header">
          {doc.doc_type === 'prescription' ? t.docs.prescription : t.docs.labReport}
        </Txt>
        <Txt size={16} tone="ink3">
          {`${when.getDate()} ${t.months[when.getMonth()]}`}
        </Txt>
      </View>
      <Txt size={16} tone="ink2">
        {doc.sent_from === 'patient_app' ? t.docs.sentByYou : t.docs.sentByClinic}
      </Txt>

      {doc.page_uri && (
        <Image
          source={{ uri: doc.page_uri }}
          style={styles.page}
          accessibilityIgnoresInvertColors
          testID={`doc-page-${doc.id}`}
        />
      )}

      {nothingRead && <Txt size={17} tone="ink2">{t.docs.nothingRead}</Txt>}

      {doc.lines.length > 0 && (
        <View style={styles.group}>
          <Txt size={17} weight="medium">{t.docs.medicines}</Txt>
          {doc.lines.map((line, i) => (
            <View key={`${line.drug_text}-${i}`} style={styles.row} testID={`doc-line-${doc.id}-${i}`}>
              <Txt latin size={19} weight="medium">{line.drug_text}</Txt>
              <Txt latin size={17} tone="ink2">
                {[line.dose_text, line.schedule_text].filter(Boolean).join('  ')}
              </Txt>
              <Checked on={line.checked} />
            </View>
          ))}
        </View>
      )}

      {doc.values.length > 0 && (
        <View style={styles.group}>
          <Txt size={17} weight="medium">{t.docs.valuesTitle}</Txt>
          {doc.values.map((v, i) => (
            <View key={`${v.analyte_name}-${i}`} style={styles.row} testID={`doc-value-${doc.id}-${i}`}>
              <Txt latin size={19} weight="medium">{v.analyte_name}</Txt>
              {v.value_text === null ? (
                <Txt size={17} tone="ink2">{t.docs.valueWaiting}</Txt>
              ) : (
                <>
                  <Txt size={19} latin>{[v.value_text, v.unit_text].filter(Boolean).join(' ')}</Txt>
                  <Checked on={v.checked} />
                </>
              )}
            </View>
          ))}
        </View>
      )}

      {doc.advice.length > 0 && (
        <View style={styles.group}>
          <Txt size={17} weight="medium">{t.docs.adviceTitle}</Txt>
          {doc.advice.map((a, i) => (
            <View key={`${a.text}-${i}`} style={styles.row} testID={`doc-advice-${doc.id}-${i}`}>
              <Txt size={18}>{a.text}</Txt>
              <Checked on={a.checked} />
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

/* Whether a clinician has settled this reading. Words, never a colour. */
function Checked({ on }: { on: boolean }) {
  const { t } = useApp()
  return <Txt size={15} tone="ink3">{on ? t.docs.checked : t.docs.unchecked}</Txt>
}

const styles = StyleSheet.create({
  card: { backgroundColor: color.surface, borderRadius: radius.md, padding: space.lg, gap: space.sm },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: space.sm },
  page: { width: '100%', height: 180, borderRadius: radius.md, resizeMode: 'contain', backgroundColor: color.sunken },
  group: { gap: space.sm, marginTop: space.sm },
  row: { backgroundColor: color.bg, borderRadius: radius.md, padding: space.md, gap: space.xs },
})
