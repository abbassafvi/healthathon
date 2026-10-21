/*
 * Lay consecutive dates out in Monday-first weeks, padding the first and
 * last week with nulls where the period starts or ends mid-week.
 */
export function weeksOf(dates: string[]): (string | null)[][] {
  const weeks: (string | null)[][] = []
  for (const date of dates) {
    const dow = (new Date(`${date}T12:00:00`).getDay() + 6) % 7 // Monday = 0
    if (weeks.length === 0 || dow === 0) weeks.push(Array(7).fill(null))
    weeks[weeks.length - 1][dow] = date
  }
  return weeks
}
