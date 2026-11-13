export const LANGUAGES = ['English', 'Turkish', 'German', 'French', 'Spanish', 'Italian', 'Portuguese']
export const COUNTRIES = ['Worldwide', 'United States', 'United Kingdom', 'Turkey', 'Germany', 'France', 'Spain', 'Canada']

export function downloadCsv(filename, rows) {
  const escape = (value) => {
    const text = String(value ?? '')
    const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text // neutralise spreadsheet formulas
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
  }
  const csv = rows.map((row) => row.map(escape).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([String.fromCharCode(0xfeff) + csv], { type: 'text/csv;charset=utf-8;' }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}
