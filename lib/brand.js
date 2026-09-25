/**
 * ============================================================================
 *  BUILDING A PALETTE FROM ONE COLOUR
 * ============================================================================
 *  A clinic picks one hex. The interface needs eleven shades — 50 through 950 —
 *  for buttons, hovers, badges, borders and dark mode.
 *
 *  WHY THIS IS JAVASCRIPT AND NOT CSS
 *  ----------------------------------
 *  The obvious version was CSS:
 *
 *      --color-brand-100: color-mix(in oklab, var(--brand) 16%, white);
 *
 *  which is valid, modern and reads beautifully. It also does not survive the
 *  build. Lightning CSS — the minifier Tailwind v4 uses — tries to evaluate
 *  color-mix() at build time, cannot, because the colour is in a `var()` that
 *  only exists at runtime, and silently emits `--color-brand-50: var(--brand)`
 *  while dropping the other ten shades entirely.
 *
 *  Nothing errors. The stylesheet is simply wrong, and every clinic's site is
 *  tinted one flat colour. Computing the shades here and injecting them as plain
 *  hex values means no build tool ever has an opinion about them.
 *
 *  WHY OKLab AND NOT JUST MIXING THE RGB NUMBERS
 *  --------------------------------------------
 *  Averaging sRGB channels passes through grey. A teal lightened that way goes
 *  chalky and a rose goes dusty, because sRGB is not perceptually uniform — equal
 *  numeric steps are not equal visual steps.
 *
 *  OKLab is built so that they are. Mixing there keeps the hue and the character
 *  of the colour at every shade, which is the difference between a palette and a
 *  set of tints. It is about thirty lines of arithmetic and it is the whole
 *  reason a clinic's site looks designed rather than recoloured.
 * ============================================================================
 */

/* -------------------------------------------------------------------------- */
/*  sRGB  ⇄  OKLab                                                             */
/* -------------------------------------------------------------------------- */

/** '#0d9488' → [13, 148, 136]. Tolerates a missing hash and mixed case. */
function hexToRgb(hex) {
  const clean = String(hex || '').trim().replace(/^#/, '')
  const full =
    clean.length === 3
      ? clean.split('').map((c) => c + c).join('')
      : clean.padEnd(6, '0').slice(0, 6)

  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) || 0)
}

function rgbToHex([r, g, b]) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)))
  return '#' + [r, g, b].map((v) => clamp(v).toString(16).padStart(2, '0')).join('')
}

/**
 * Undo the sRGB transfer function.
 *
 * The numbers in a hex code are NOT proportional to light — they are
 * gamma-encoded so that dark tones get more precision, which is where most of
 * human sensitivity lies. Every colour calculation has to undo that first, or it
 * is doing arithmetic on the encoding rather than on the colour.
 */
const toLinear = (c) => {
  const v = c / 255
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
}

const toSrgb = (c) => {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055
  return v * 255
}

/** sRGB → OKLab. The matrices are from Björn Ottosson's definition. */
function rgbToOklab([r, g, b]) {
  const lr = toLinear(r)
  const lg = toLinear(g)
  const lb = toLinear(b)

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb)
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb)
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb)

  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/** OKLab → sRGB. */
function oklabToRgb([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3

  return [
    toSrgb(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    toSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    toSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ]
}

/** Blend two colours in OKLab. `amount` is how much of the FIRST to keep. */
function mix(hexA, hexB, amount) {
  const a = rgbToOklab(hexToRgb(hexA))
  const b = rgbToOklab(hexToRgb(hexB))
  return rgbToHex(oklabToRgb(a.map((v, i) => v * amount + b[i] * (1 - amount))))
}

/* -------------------------------------------------------------------------- */
/*  THE RAMP                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * The proportions each shade keeps of the chosen colour.
 *
 * Tuned against the default teal so an untouched clinic looks exactly as it
 * always did. 600 is the colour itself, because that is the shade Tailwind uses
 * for a primary button and therefore the one a clinic is actually picking when
 * they choose "our colour".
 */
const RAMP = [
  [50, 0.08, 'white'],
  [100, 0.16, 'white'],
  [200, 0.3, 'white'],
  [300, 0.48, 'white'],
  [400, 0.72, 'white'],
  [500, 0.88, 'white'],
  [600, 1, null],
  [700, 0.82, 'black'],
  [800, 0.66, 'black'],
  [900, 0.52, 'black'],
  [950, 0.3, 'black'],
]

const WHITE = '#ffffff'
const BLACK = '#000000'

/**
 * The shades CSS needs as raw channels, not hex.
 *
 * WHY BOTH FORMS ARE EMITTED
 * --------------------------
 * `--color-brand-400: #2dd4bf` is what Tailwind's utilities want. But a gradient
 * needs the SAME colour at 22% opacity, and there is no way to add alpha to a hex
 * held in a custom property without one of:
 *
 *     color-mix(in oklab, var(--color-brand-400) 22%, transparent)
 *     rgb(from var(--color-brand-400) r g b / 0.22)
 *
 * The first is the one this file already exists to avoid — Lightning CSS tries to
 * evaluate color-mix() at build time, cannot resolve the var(), and silently emits
 * something wrong (see the long note at the top). The second is newer syntax with
 * the same class of risk.
 *
 * So the channels go out separately as `--brand-rgb-400: 45 212 191`, and CSS
 * writes `rgb(var(--brand-rgb-400) / 0.22)`. Old, boring, and no build tool has an
 * opinion about it.
 *
 * Only 400/500/600 — the three the mesh background uses. Emitting all eleven would
 * double the inline style on every page to no purpose.
 */
const CHANNEL_SHADES = [400, 500, 600]

/** Eleven shades as hex, plus three as rgb channels for gradients. */
export function brandRamp(hex) {
  const base = /^#?[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(String(hex || '').trim())
    ? hex
    : '#0d9488'

  const shades = {}
  for (const [step, amount, towards] of RAMP) {
    shades[`--color-brand-${step}`] =
      towards === null ? rgbToHex(hexToRgb(base)) : mix(base, towards === 'white' ? WHITE : BLACK, amount)
  }

  for (const step of CHANNEL_SHADES) {
    shades[`--brand-rgb-${step}`] = hexToRgb(shades[`--color-brand-${step}`]).join(' ')
  }

  return shades
}

/**
 * Black or white text, whichever is readable on this colour.
 *
 * Every primary button in the app puts white text on the brand colour, which is
 * fine for a teal and unreadable on a bright yellow. Using the OKLab lightness
 * rather than a naive brightness average means it is right for saturated colours
 * too — a pure blue and a pure yellow have similar sRGB averages and completely
 * different perceived lightness.
 */
export function readableTextOn(hex) {
  const [L] = rgbToOklab(hexToRgb(hex))
  return L > 0.62 ? '#0f172a' : '#ffffff'
}

/**
 * Everything a clinic's colour sets, as one inline `style` object.
 *
 * Put on <html> by app/layout.js, so it reaches every page on the clinic's
 * address — website, booking, patient dashboard, admin, video room, login — and
 * the toasts and menus that render outside any page wrapper too.
 */
export function brandStyle(hex) {
  return {
    '--clinic-brand': hex,
    ...brandRamp(hex),
    '--color-brand-fg': readableTextOn(hex),
  }
}
