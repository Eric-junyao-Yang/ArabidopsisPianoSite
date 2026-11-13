import { PALETTE, THEME, hexToRgb01 } from "/src/plotTheme.js"
import { energyPctAtPeriod } from "/src/plotHarmonics.js"

export const QVAL_CUTOFF = 0.01
const PHASE_SCALE_H = 48
const DEFAULT_ENERGY_PERIOD_H = 24

const PHASE_INTERPOLATOR = d3.interpolateTurbo
const QVAL_INTERPOLATOR = d3.interpolateInferno
const QVAL_NEGLOG10_MAX = 5
const ENERGY_INTERPOLATOR = d3.interpolateViridis

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
export function phaseField(displayMode) {
    return displayMode === "Circadian" ? "metacycle_phase" : "LS_phase"
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
            title: displayMode === "Circadian" ? "MetaCycle peak" : "peak time",
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
        // Fixed 0–100%: energy share is already a percentile of the spectrum.
        const periodHours = selectedEnergyPeriodHours()
        return {
            interpolator: ENERGY_INTERPOLATOR,
            leftLabel: "0%",
            rightLabel: "100%",
            title: `% ${periodHours}h energy`,
            gradIdSuffix: "energy",
            color01(_meta, geneId) {
                const energyPct = energyPctAtPeriod(geneId, specsLookup, periodHours)
                if (energyPct == null || !Number.isFinite(energyPct)) return null
                return normalizeToDomain(energyPct, 0, 100)
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
