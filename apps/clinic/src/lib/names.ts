/* "Dr. Demo Clinician" is "DC": titles are not initials. */
export function initials(name: string): string {
  const words = name.split(/\s+/).filter((w) => w && !/^(dr|mr|mrs|ms|prof)\.?$/i.test(w))
  return (words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase()
}
