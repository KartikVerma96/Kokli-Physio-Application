/**
 * Print the four WhatsApp templates, ready to paste into Meta's form.
 *
 *     npm run whatsapp:templates
 *
 * Separate from the library because lib/whatsappTemplates.js uses the `@/` alias
 * that only Next.js resolves — and this needs to run from a plain terminal while
 * somebody has Meta's Business Manager open in the other window.
 */
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(path.join(__dirname, '..', 'lib', 'whatsappTemplates.js'), 'utf8')

// Pull each template's name, category and body straight out of the source, so
// there is one copy of the wording and it cannot drift from what the app sends.
const blocks = [...source.matchAll(/metaName: '([^']+)',\s*category: '([^']+)',\s*language: '([^']+)',[\s\S]*?submission: `([\s\S]*?)`,/g)]

console.log(`
════════════════════════════════════════════════════════════════════
 WHATSAPP TEMPLATES — submit at
 business.facebook.com → WhatsApp Manager → Message Templates → Create
════════════════════════════════════════════════════════════════════

 Business verification must be done FIRST and takes 3–10 days. Start it
 today; template approval afterwards is usually a few hours.
`)

for (const [, name, category, language, body] of blocks) {
  console.log('─'.repeat(68))
  console.log(` NAME      ${name}`)
  console.log(` CATEGORY  ${category.toUpperCase()}`)
  console.log(` LANGUAGE  ${language}`)
  console.log('')
  console.log(' BODY — paste exactly, keeping the {{n}} placeholders:')
  console.log('')
  for (const line of body.split('\n')) console.log(`   ${line}`)
  console.log('')
}

console.log('─'.repeat(68))
console.log(`
 Once approved, add to .env.local:

   WHATSAPP_PHONE_NUMBER_ID=...
   WHATSAPP_TOKEN=...
   WHATSAPP_VERIFY_TOKEN=<any random string, for the webhook>

 Until then every message prints to the terminal instead of sending, so the
 whole feature can be demonstrated to a clinic today.
`)
