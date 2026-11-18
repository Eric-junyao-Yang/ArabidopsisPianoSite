import { THEME, hexToRgb01 } from "../plots/plotTheme.js"

/**
 * Value → color plumbing for the UMAPs. Which value and which scale a mode uses lives in colorModes.js;
 * here a scale (continuous or categorical, see COLOR_MODES) turns each point's d.metricVal into RGB.
 */

const DEFAULT_RGB = hexToRgb01(THEME.pointActive)

export function rgb01ToCss([r, g, b], a = 1) {
    return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`
}

function cssToRgb01(color) {
    const c = d3.rgb(color)
    return [c.r / 255, c.g / 255, c.b / 255]
}

function clamp01(t) {
    return Math.max(0, Math.min(1, t))
}

/** Map value → [0,1] over [lo, hi]; flat domain → mid. */
function normalizeToDomain(value, lo, hi) {
    if (!(hi > lo)) return 0.5
    return clamp01((value - lo) / (hi - lo))
}

export function extentOrFallback(values, fallbackLo, fallbackHi) {
    const [lo, hi] = d3.extent(values)
    if (lo == null || hi == null || !Number.isFinite(lo) || !Number.isFinite(hi)) {
        return [fallbackLo, fallbackHi]
    }
    if (hi > lo) return [lo, hi]
    // Single unique value — keep a tiny span so the legend still reads, color → mid.
    const pad = Math.max(Math.abs(lo) * 1e-6, 1e-9)
    return [lo - pad, hi + pad]
}

export function formatLegendNum(v, digits = 1) {
    if (!Number.isFinite(v)) return "—"
    if (Math.abs(v) > 0 && Math.abs(v) < 1e-3) return Number(v).toExponential(0)
    if (Math.abs(v - Math.round(v)) < 1e-6) return String(Math.round(v))
    return Number(v).toFixed(digits)
}

/** Gene panel number: "—" when missing, exponent for tiny values. */
export function formatNumber(value, digits = 2) {
    if (value == null || !Number.isFinite(Number(value))) return "—"
    const n = Number(value)
    if (Math.abs(n) > 0 && Math.abs(n) < 1e-3) return n.toExponential(2)
    return n.toFixed(digits)
}

/** RGB in [0,1] for one value, or null when the value has no color (missing / no category). */
function valueToRgb01(scale, value) {
    if (!Number.isFinite(value)) return null
    if (scale.categories) {
        const category = scale.categories.find((c) => c.test(value))
        return category ? cssToRgb01(category.color) : null
    }
    const t = normalizeToDomain(value, scale.domain[0], scale.domain[1])
    return cssToRgb01(scale.interpolator(t))
}

/** Per-point RGB (length n*3) from each point's d.metricVal. scale = null → every point default. */
export function buildColorRgbArr(umap_arr, scale) {
    const n = umap_arr.length
    const rgb = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
        const col = (scale && valueToRgb01(scale, umap_arr[i].metricVal)) || DEFAULT_RGB
        rgb[i * 3] = col[0]
        rgb[i * 3 + 1] = col[1]
        rgb[i * 3 + 2] = col[2]
    }
    return rgb
}
