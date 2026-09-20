/**
 * ============================================================================
 *  STATIC CHECK: is every tenant-scoped query actually given a clinic?
 * ============================================================================
 *
 *  Reads the source, finds every function in lib/queries.js and lib/razorpay.js
 *  whose first parameter is the clinic, and checks that every call site passes
 *  something that plausibly IS a clinic id.
 *
 *  WHY A GREP AND NOT A TYPE SYSTEM
 *  --------------------------------
 *  Because this codebase is deliberately JavaScript, and `getAllServices()` with
 *  no arguments is perfectly legal JavaScript. TypeScript would catch all of this
 *  at the cost of the thing the project is for — being readable by someone
 *  learning. Thirty lines of grep buys most of the same protection for the one
 *  mistake that actually happened, five times:
 *
 *      getAllServices()                     /admin/services crashed
 *      getAdminStats()                      /admin/payments crashed
 *      getAppointmentNotes(appointment.id)  /admin/appointments/[id] crashed
 *      getPatientRecord(appointment.id)     same page, same line
 *      createOrder({ amountPaise })         every booking 502'd
 *
 *  THE SECOND KIND IS THE INTERESTING ONE
 *  --------------------------------------
 *  `getAppointmentNotes(appointment.id)` is worse than `getAllServices()` because
 *  it LOOKS right. An id was passed; it was simply the wrong id. A checker that
 *  only counts arguments cannot see it, which is why this one insists the first
 *  argument look like a clinic — `clinic.id`, `clinicId`, `session.user.clinicId`
 *  and nothing else.
 *
 *  It needs no server and no database. Run it before anything else.
 * ============================================================================
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

let failures = 0
const fail = (message) => {
  failures++
  console.log(`  ✗ ${message}`)
}

/* -------------------------------------------------------------------------- */
/*  1. WHICH FUNCTIONS ARE TENANT-SCOPED                                      */
/* -------------------------------------------------------------------------- */

/**
 * A function is tenant-scoped if its first parameter is named `clinicId` or
 * `clinic`. That convention is the whole basis of this check, which is a good
 * reason to keep to it: a scoped query whose first argument is called something
 * else is invisible here.
 */
function scopedFunctions(file) {
  const source = fs.readFileSync(file, 'utf8')
  const found = new Map()

  const pattern = /export\s+(?:async\s+)?function\s+(\w+)\s*\(\s*(\w+)/g
  for (const [, name, firstParam] of source.matchAll(pattern)) {
    if (firstParam === 'clinicId' || firstParam === 'clinic') {
      found.set(name, firstParam)
    }
  }
  return found
}

/* -------------------------------------------------------------------------- */
/*  2. EVERY FILE THAT MIGHT CALL THEM                                        */
/* -------------------------------------------------------------------------- */

function sourceFiles(dir, collected = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) sourceFiles(full, collected)
    else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) collected.push(full)
  }
  return collected
}

/**
 * Strip comments before searching.
 *
 * The first version of this check reported lib/seo.js as broken because a COMMENT
 * mentioned `getRatingSummary()`. A checker that cries wolf gets switched off, so
 * it is worth the extra ten lines to be right.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (match, prefix) => prefix + ' '.repeat(match.length - prefix.length))
}

/** Read one balanced argument, so a nested call does not confuse the split. */
function firstArgument(text) {
  let depth = 0
  let arg = ''
  for (const char of text) {
    if ('([{'.includes(char)) depth++
    else if (')]}'.includes(char)) {
      if (depth === 0) break
      depth--
    } else if (char === ',' && depth === 0) break
    arg += char
  }
  return arg.trim()
}

/**
 * Does this argument look like a clinic?
 *
 * Deliberately a whitelist. Anything unfamiliar is reported rather than assumed
 * fine — a false alarm costs one line in this file, a miss costs a broken page.
 */
const CLINIC_SHAPED = [
  /^clinic$/,
  /^clinic\.id$/,
  /^clinicId$/,
  /^currentClinic(\.id)?$/,
  /^(session|user)(\?)?\.(user\.)?clinicId$/,
  /^Number\(\s*(session|user)(\?)?\.(user\.)?clinicId\s*\)$/,
  /^subscription\.clinic_id$/,
  /^\w*[Cc]linic(Row)?\.id$/,
  /^\w*clinic_id$/,
  // `site` is the clinic mapped for display by lib/clinicView.js, and it keeps
  // the clinic's id. Components take the view object rather than the raw row, so
  // this is the correct shape there, not a near-miss.
  /^site\.id$/,
]

/* -------------------------------------------------------------------------- */
/*  3. THE CHECK                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Every library that exposes clinic-scoped functions.
 *
 * lib/recalls.js and lib/packages.js were added later and were NOT in this list,
 * which is how `unfinishedPackages` shipped with a `?` placeholder and no
 * parameter array — the exact bug this file exists to catch, in a file it was not
 * looking at. A checker with a hardcoded list of inputs is only as good as the
 * list, so adding a lib here is part of adding a lib.
 */
const SCOPED_LIBS = ['lib/queries.js', 'lib/razorpay.js', 'lib/packages.js', 'lib/recalls.js']

const definitions = new Map()
for (const file of SCOPED_LIBS) {
  for (const [name, param] of scopedFunctions(file)) {
    definitions.set(name, { param, file })
  }
}

console.log(`\nTENANT SCOPING`)
console.log(
  `  ${definitions.size} functions take a clinic first: ${[...definitions.keys()].sort().join(', ')}\n`
)

let callSites = 0

for (const file of sourceFiles('.')) {
  const relative = path.relative('.', file)
  // The definitions themselves, and the tests, are not call sites to police.
  if (SCOPED_LIBS.includes(relative)) continue
  if (relative.startsWith('tests/')) continue

  const source = stripComments(fs.readFileSync(file, 'utf8'))

  for (const [name] of definitions) {
    for (const match of source.matchAll(new RegExp(`\\b${name}\\s*\\(`, 'g'))) {
      // Skip the import statement itself.
      const lineStart = source.lastIndexOf('\n', match.index) + 1
      const line = source.slice(lineStart, source.indexOf('\n', match.index))
      if (/^\s*import\b/.test(line)) continue

      callSites++
      const arg = firstArgument(source.slice(match.index + match[0].length))
      const lineNumber = source.slice(0, match.index).split('\n').length

      if (arg === '') {
        fail(`${relative}:${lineNumber}  ${name}() — called with NO arguments`)
      } else if (!CLINIC_SHAPED.some((shape) => shape.test(arg))) {
        fail(
          `${relative}:${lineNumber}  ${name}(${arg}…) — first argument does not look like a clinic`
        )
      }
    }
  }
}

console.log(
  failures === 0
    ? `  ✓ all ${callSites} call sites pass a clinic\n`
    : `\n  ${callSites} call sites checked\n`
)

console.log(failures === 0 ? '✓ EVERY QUERY IS TENANT-SCOPED\n' : `✗ ${failures} UNSCOPED CALL(S)\n`)
process.exit(failures === 0 ? 0 : 1)
