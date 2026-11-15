import { PALETTE, THEME, hexToRgb01 } from "/src/plots/plotTheme.js"
import { energyPctAtPeriod } from "/src/plots/plotHarmonics.js"

export const QVAL_CUTOFF = 0.01
const PHASE_SCALE_H = 48
const DEFAULT_ENERGY_PERIOD_H = 24

const PHASE_INTERPOLATOR = d3.interpolateTurbo
const QVAL_INTERPOLATOR = d3.interpolateInferno
const QVAL_NEGLOG10_MAX = 5
const ENERGY_INTERPOLATOR = d3.interpolateViridis
// Reversed so bright = low relative std = confident fit (bright = "more" in every other mode too)
const WAVE_CONF_INTERPOLATOR = (t) => d3.interpolateCividis(1 - t)

export function rgb01ToCss([r, g, b], a = 1) {
    return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`
}

function interpToRgb01(interpolator, t) {
    const c = d3.rgb(interpolator(Math.max(0, Math.min(1, t))))
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

function extentOrFallback(values, fallbackLo, fallbackHi) {
    const [lo, hi] = d3.extent(values)
    if (lo == null || hi == null || !Number.isFinite(lo) || !Number.isFinite(hi)) {
        return [fallbackLo, fallbackHi]
    }
    if (hi > lo) return [lo, hi]
    // Single unique value — keep a tiny span so the legend still reads, color → mid.
    const pad = Math.max(Math.abs(lo) * 1e-6, 1e-9)
    return [lo - pad, hi + pad]
}

function formatLegendNum(v, digits = 1) {
    if (!Number.isFinite(v)) return "—"
    if (Math.abs(v) > 0 && Math.abs(v) < 1e-3) return Number(v).toExponential(0)
    if (Math.abs(v - Math.round(v)) < 1e-6) return String(Math.round(v))
    return Number(v).toFixed(digits)
}

/** Currently selected harmonic period (hours) from the oscillation-energy radios. */
export function selectedEnergyPeriodHours() {
    const el = document.querySelector('input[name="oscillation_energy"]:checked')
    const period = el ? Number(el.value) : DEFAULT_ENERGY_PERIOD_H
    return Number.isFinite(period) ? period : DEFAULT_ENERGY_PERIOD_H
}

/** Circadian display → MetaCycle fields; All genes → Lomb–Scargle fields. */
/** Per-gene meta field for the raw peak: sample hour of the highest VST measurement (set in main.js). */
export const PEAK_HOUR_FIELD = "peak_hour"

/**
 * Peak-time field per gene set. All genes: raw peak hour (no period is trusted for every gene).
 * Circadian: MetaCycle phase, folded by a 20–28 h period that these genes passed q ≤ 0.01 for.
 */
export function phaseField(displayMode) {
    return displayMode === "Circadian" ? "metacycle_phase" : PEAK_HOUR_FIELD
}

export function qvalField(displayMode) {
    return displayMode === "Circadian" ? "metacycle_qval" : "LS_qval"
}

export function continuousColorScale(mode, umap_arr, metaByGene, specsLookup, displayMode = "All") {
    if (mode === "phase") {
        const field = phaseField(displayMode)
        const vals = []
        for (const d of umap_arr) {
            const phase = metaByGene.get(d.GeneID)?.[field]
            if (phase != null && Number.isFinite(phase)) vals.push(phase)
        }
        const [lo, hi] = extentOrFallback(vals, 0, PHASE_SCALE_H)
        return {
            interpolator: PHASE_INTERPOLATOR,
            leftLabel: `${formatLegendNum(lo, 1)}h`,
            rightLabel: `${formatLegendNum(hi, 1)}h`,
            title: displayMode === "Circadian" ? "MetaCycle peak" : "peak hour",
            gradIdSuffix: "phase",
            color01(meta) {
                const phase = meta?.[field]
                if (phase == null || !Number.isFinite(phase)) return null
                return normalizeToDomain(phase, lo, hi)
            },
        }
    }
    if (mode === "qval") {
        // Fixed −log₁₀ domain: absolute significance / threshold comparison.
        const field = qvalField(displayMode)
        const isMeta = displayMode === "Circadian"
        return {
            interpolator: QVAL_INTERPOLATOR,
            leftLabel: "1",
            rightLabel: `1e-${QVAL_NEGLOG10_MAX}`,
            title: isMeta ? "−log₁₀ MetaCycle q" : "−log₁₀ LS q",
            gradIdSuffix: "qval",
            color01(meta) {
                const q = meta?.[field]
                if (q == null || !Number.isFinite(q)) return null
                return normalizeToDomain(-Math.log10(Math.max(q, 1e-300)), 0, QVAL_NEGLOG10_MAX)
            },
        }
    }
    if (mode === "energyPct") {
        // All genes: fixed 0–100%, energy share is already a percentile of the spectrum.
        // Circadian: shares bunch up (e.g. 24h mostly high), so stretch the colors over the data range.
        const periodHours = selectedEnergyPeriodHours()
        let lo = 0
        let hi = 100
        if (displayMode === "Circadian") {
            const vals = []
            for (const d of umap_arr) {
                const energyPct = energyPctAtPeriod(d.GeneID, specsLookup, periodHours)
                if (energyPct != null && Number.isFinite(energyPct)) vals.push(energyPct)
            }
            [lo, hi] = extentOrFallback(vals, 0, 100)
            lo = 0 // still set floor
            
        }
        return {
            interpolator: ENERGY_INTERPOLATOR,
            leftLabel: `${formatLegendNum(lo, 1)}%`,
            rightLabel: `${formatLegendNum(hi, 1)}%`,
            title: `% ${periodHours}h energy`,
            gradIdSuffix: "energy",
            color01(_meta, geneId) {
                const energyPct = energyPctAtPeriod(geneId, specsLookup, periodHours)
                if (energyPct == null || !Number.isFinite(energyPct)) return null
                return normalizeToDomain(energyPct, lo, hi)
            },
        }
    }
    if (mode === "waveConf") {
        // GP relative std (meta.gp_relative_std, circadian genes only). Long right tail (most genes
        // ~0.2-0.5, a few up to ~3), so the top of the scale is the 98th percentile; above it saturates.
        const vals = []
        for (const d of umap_arr) {
            const v = metaByGene.get(d.GeneID)?.gp_relative_std
            if (v != null && Number.isFinite(v)) vals.push(v)
        }
        vals.sort(d3.ascending)
        const [lo, hi] = extentOrFallback([vals[0], d3.quantileSorted(vals, 0.98)], 0, 1)
        return {
            interpolator: WAVE_CONF_INTERPOLATOR,
            leftLabel: formatLegendNum(lo, 2),
            rightLabel: `≥${formatLegendNum(hi, 2)}`,
            title: "GP relative std",
            gradIdSuffix: "waveconf",
            color01(meta) {
                const v = meta?.gp_relative_std
                if (v == null || !Number.isFinite(v)) return null
                return normalizeToDomain(v, lo, hi)
            },
        }
    }
    return null
}

/** Build per-point RGB (length n*3) for a color mode. Filter is applied separately via selected. */
export function buildColorRgbArr(mode, umap_arr, metaByGene, specsLookup, displayMode = "All") {
    const n = umap_arr.length
    const rgb = new Float32Array(n * 3)
    const defaultRgb = hexToRgb01(THEME.pointActive)
    const sigRgb = hexToRgb01(PALETTE.teal)
    const nsigRgb = hexToRgb01(THEME.pointActive)
    const scale = continuousColorScale(mode, umap_arr, metaByGene, specsLookup, displayMode)

    for (let i = 0; i < n; i++) {
        const geneId = umap_arr[i].GeneID
        const meta = metaByGene.get(geneId)
        let col = defaultRgb
        if (mode === "circadian") {
            const q = meta?.metacycle_qval
            col = (q != null && q <= QVAL_CUTOFF) ? sigRgb : nsigRgb
        } else if (scale) {
            const t = scale.color01(meta, geneId)
            if (t != null) col = interpToRgb01(scale.interpolator, t)
        }
        rgb[i * 3] = col[0]
        rgb[i * 3 + 1] = col[1]
        rgb[i * 3 + 2] = col[2]
    }
    return rgb
}
