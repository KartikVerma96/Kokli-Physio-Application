/**
 * ============================================================================
 *  ICON
 * ============================================================================
 *  Services store an icon NAME in the database ('Activity', 'Brain'), because
 *  you cannot store a React component in a MySQL column. This turns that string
 *  back into a component.
 *
 *  WHY AN EXPLICIT MAP INSTEAD OF `import * as icons from 'lucide-react'`?
 *  ---------------------------------------------------------------------
 *  Because a wildcard import can defeat tree-shaking and pull all ~1,600
 *  lucide icons into the bundle. That is well over a megabyte of JavaScript
 *  shipped to a patient on mobile data to draw twelve small pictures.
 *
 *  Page weight is not just politeness — Largest Contentful Paint is a direct
 *  Google ranking factor, and JavaScript is the most expensive thing on a page.
 *  Listing the icons we actually use keeps the bundle honest.
 *
 *  To add an icon: find its name at lucide.dev, import it, add it to the map.
 * ============================================================================
 */

import {
  Activity, Baby, Brain, ClipboardList, Footprints, HeartPulse, PersonStanding,
  RotateCw, Trophy, Zap, Stethoscope, Dumbbell, Hand, Bone, Accessibility,
} from 'lucide-react'

const ICONS = {
  Activity,
  Baby,
  Brain,
  ClipboardList,
  Footprints,
  HeartPulse,
  PersonStanding,
  RotateCw,
  Trophy,
  Zap,
  Stethoscope,
  Dumbbell,
  Hand,
  Bone,
  Accessibility,
}

/** Names offered in the admin service editor's icon dropdown. */
export const ICON_NAMES = Object.keys(ICONS)

export default function Icon({ name, className = 'size-5', ...props }) {
  // Fall back rather than crash: a typo in the database should show a generic
  // icon, not take the whole services page down with it.
  const Component = ICONS[name] || Activity
  return <Component className={className} aria-hidden="true" {...props} />
}
