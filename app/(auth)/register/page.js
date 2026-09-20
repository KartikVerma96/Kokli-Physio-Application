import { buildMetadata } from '@/lib/seo'
import { googleEnabled } from '@/auth.config'
import RegisterForm from './RegisterForm'

/**
 * ============================================================================
 *  CREATE ACCOUNT  →  /register
 * ============================================================================
 */

export const metadata = buildMetadata({
  title: 'Create your account',
  description:
    'Create a patient account to book physiotherapy appointments, join online video consultations and access your prescribed exercises.',
  path: '/register',
  noIndex: true,
})

export default async function RegisterPage({ searchParams }) {
  const params = await searchParams

  return (
    <RegisterForm
      googleEnabled={googleEnabled}
      next={sanitiseNext(params?.next)}
    />
  )
}

/** Only relative paths, to prevent an open-redirect. Same as the login page. */
function sanitiseNext(next) {
  if (typeof next !== 'string') return null
  if (!next.startsWith('/') || next.startsWith('//')) return null
  return next
}
