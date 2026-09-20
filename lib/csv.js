/**
 * ============================================================================
 *  CSV, WRITTEN BY HAND
 * ============================================================================
 *  No dependency, because CSV is thirty lines and every library that does it also
 *  does forty other things.
 *
 *  THE FOUR RULES THAT MATTER
 *  --------------------------
 *  Getting these wrong produces a file that opens fine in a spot check and
 *  silently corrupts the one row somebody cares about:
 *
 *    1. QUOTE anything containing a comma, a quote or a newline. A clinical note
 *       is free text and will contain all three. An address contains commas.
 *
 *    2. DOUBLE an embedded quote — `5" scar` becomes `"5"" scar"`. Escaping it
 *       with a backslash is the C habit and is simply wrong here.
 *
 *    3. CRLF line endings, because that is what the spec says and what Excel on
 *       Windows expects. A clinic will open this in Excel, not in a text editor.
 *
 *    4. A UTF-8 BYTE ORDER MARK at the front. Without it Excel on Windows reads
 *       the file as the local codepage and every Devanagari name, every ₹ sign and
 *       every é turns to mojibake. This is the single most common reason an export
 *       "works" for the developer and looks broken to the customer.
 *
 *  THE FORMULA-INJECTION RULE
 *  --------------------------
 *  A cell starting with =, +, - or @ is executed as a formula by Excel and Google
 *  Sheets. A patient whose name field contains `=HYPERLINK(...)` becomes a live
 *  link in the clinic's spreadsheet; there are worse payloads. Prefixing those
 *  cells with a tab makes them text and is invisible in the sheet.
 * ============================================================================
 */

/** True if the value needs quoting. */
const NEEDS_QUOTES = /[",\r\n]/

/** Excel and Sheets treat these as the start of a formula. */
const FORMULA_START = /^[=+\-@\t\r]/

function cell(value) {
  if (value === null || value === undefined) return ''

  // Dates come back from mysql2 as Date objects. ISO is unambiguous; a localised
  // string is not, and 03/04/2026 means two different days either side of an ocean.
  let text = value instanceof Date ? value.toISOString() : String(value)

  if (FORMULA_START.test(text)) text = `\t${text}`
  if (NEEDS_QUOTES.test(text)) text = `"${text.replace(/"/g, '""')}"`
  return text
}

/**
 * Rows of objects → a CSV string.
 *
 * `columns` is a list of either 'db_column' or ['db_column', 'Nice Header'].
 * Explicit rather than inferred from the first row: a row with a NULL in the last
 * column would otherwise decide the whole file's shape, and the header a clinic
 * reads should say "Patient name", not "patient_name".
 */
export function toCsv(rows, columns) {
  const keys = columns.map((c) => (Array.isArray(c) ? c[0] : c))
  const headers = columns.map((c) => (Array.isArray(c) ? c[1] : c))

  const lines = [headers.map(cell).join(',')]
  for (const row of rows) {
    lines.push(keys.map((key) => cell(row[key])).join(','))
  }

  // BOM + CRLF. See rules 3 and 4 above.
  return '﻿' + lines.join('\r\n') + '\r\n'
}

/** A Response that downloads rather than displays. */
export function csvResponse(csv, filename) {
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      // The quotes matter: a clinic name with a space in it breaks the header
      // without them, and the browser saves the file as "download".
      'Content-Disposition': `attachment; filename="${safeFilename(filename)}"`,
      // An export is a snapshot of live data and must never be served from a cache
      // — least of all a shared one, given what is in it.
      'Cache-Control': 'no-store, private',
    },
  })
}

/** A JSON download, for the full-record exports. */
export function jsonResponse(data, filename) {
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safeFilename(filename)}"`,
      'Cache-Control': 'no-store, private',
    },
  })
}

/**
 * Strip anything that could escape the filename.
 *
 * The clinic's own name goes into this, and a slash or a CR in a header value is
 * a response-splitting bug rather than a cosmetic one.
 */
function safeFilename(name) {
  return String(name).replace(/[^\w.\-]+/g, '-').slice(0, 120)
}

/** '2026-08-05', for filenames. */
export function stamp() {
  return new Date().toISOString().slice(0, 10)
}
