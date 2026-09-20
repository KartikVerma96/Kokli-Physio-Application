import { Download, FileJson } from 'lucide-react'
import { Card } from '@/components/ui/Card'

/**
 * ============================================================================
 *  "DOWNLOAD MY DATA"
 * ============================================================================
 *  A plain link, not a button with a fetch behind it.
 *
 *  WHY A LINK
 *  ----------
 *  Downloading a file is what an `<a href>` has always done. Doing it in
 *  JavaScript means reading the whole response into memory, building a Blob,
 *  creating an object URL, synthesising a click and then revoking the URL — every
 *  step of which can fail on a phone, and none of which the browser needed help
 *  with. The link also works with JavaScript disabled and shows real download
 *  progress.
 *
 *  This is a Server Component for the same reason: there is no state here.
 *
 *  WHY IT IS ON THE PROFILE PAGE
 *  -----------------------------
 *  A patient exercising their right of access under the DPDP Act will not go
 *  looking for a settings menu. It sits under the medical history they came here to
 *  edit, which is the one page where the question "what do you actually hold about
 *  me?" naturally occurs.
 * ============================================================================
 */

export default function DataExportCard() {
  return (
    <Card className="p-5">
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ink-100 dark:bg-ink-800">
          <FileJson className="size-4.5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="font-bold">Download your data</h2>
          <p className="mt-0.5 text-sm text-ink-500 dark:text-ink-400">
            Everything this clinic holds about you — your profile, appointments, payments, clinical
            notes and the messages we sent. It is your data and you can have a copy whenever you
            want one.
          </p>

          <a
            href="/api/export/me"
            // `download` asks the browser to save rather than navigate, even though
            // the Content-Disposition header already says so. Belt and braces: some
            // in-app browsers honour one and not the other.
            download
            className="mt-4 inline-flex h-11 items-center gap-2 rounded-xl border border-ink-200 px-4 text-sm font-semibold transition-colors hover:bg-ink-50 dark:border-ink-700 dark:hover:bg-ink-800"
          >
            <Download className="size-4" aria-hidden="true" />
            Download my data (JSON)
          </a>

          <p className="mt-3 text-xs text-ink-400">
            Your password is not included — it is stored as a one-way hash that nobody, including
            the clinic, can read back.
          </p>
        </div>
      </div>
    </Card>
  )
}
