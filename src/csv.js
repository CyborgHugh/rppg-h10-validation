export function toCsv(rows, columns = null) {
  const cols = columns ?? collectColumns(rows);
  const lines = [cols.map(escapeCsv).join(',')];
  for (const row of rows) {
    lines.push(cols.map((col) => escapeCsv(row[col])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

export function appendCsvLine(row, columns) {
  return `${columns.map((col) => escapeCsv(row[col])).join(',')}\n`;
}

export function collectColumns(rows) {
  const seen = new Set();
  for (const row of rows) {
    for (const key of Object.keys(row)) seen.add(key);
  }
  return [...seen];
}

function escapeCsv(value) {
  if (value === null || value === undefined) return '';
  const str = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/[",\n\r]/.test(str)) {
    return `"${str.replaceAll('"', '""')}"`;
  }
  return str;
}
