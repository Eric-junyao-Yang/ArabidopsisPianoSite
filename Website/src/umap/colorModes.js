import { PALETTE, THEME } from "../plots/plotTheme.js"
import { energyPctAtPeriod } from "../plots/plotHarmonics.js"
import { EXP_HOURS } from "../GaussianProcess/GPalgo.js"
import { extentOrFallback, formatLegendNum, formatNumber } from "./umapColors.js"

/**
 * UMAP color modes, one entry per mode. Each mode is described once here and everything else reads it:
 *   metric(ctx)          what number a gene gets. Written onto every point as d.metricVal (main.js),
 *                        so the UMAP colors, violin and filter all use the same value
 *     label              violin axis label
 *     short              gene panel label
 *     valueOf(GeneID)    the gene's value, NaN when it has none
 *     format(v)          gene panel text
 *     levels             optional: the only values it can take (violin draws bars)
 *   scale(ctx, values)   how values become colors, given the values of the genes on the map.
 *                        null = no coloring. Continuous: { interpolator, domain, leftLabel, rightLabel, title }
 *                        Categorical: { categories: [{ label, color, test(v) }] }, first match wins
 *   help                 hint text per gene set
 *   availableIn          gene sets the mode makes sense for (default both)
 *   fallback             mode to switch to when the gene set changes to one it isn't available in
 *
 * ctx = { displayMode, options: { energyPeriod }, data: { meta, gp, counts, specs } }
 *
 * To add a mode: add an entry here, then a button in index.html and a row in COLOR_BUTTONS (main.js).
 */

export const QVAL_CUTOFF = 0.01
const QVAL_NEGLOG10_MAX = 5

/** Per-gene meta field for the raw peak: sample hour of the highest VST measurement (set in main.js). */
export const PEAK_HOUR_FIELD = "peak_hour"

/** Circadian: MetaCycle fields; All genes: Lomb–Scargle q and the raw peak hour. */
export function phaseField(displayMode) {
    return displayMode === "Circadian" ? "metacycle_phase" : PEAK_HOUR_FIELD
}

export function qvalField(displayMode) {
    return displayMode === "Circadian" ? "metacycle_qval" : "LS_qval"
}

const negLog10 = (q) => (Number.isFinite(q) ? -Math.log10(Math.max(q, 1e-300)) : NaN)
const fromNegLog10 = (v) => formatNumber(10 ** -v, 3)
const withUnit = (text, unit) => (text === "—" ? text : `${text}${unit}`)

export const COLOR_MODES = {
    none: {
        // No coloring; the violin still filters on mean expression
        metric: (ctx) => ({
            label: "log10(mean TPM)",
            short: "log10 TPM",
            valueOf: (GeneID) => ctx.data.counts.get(GeneID)?.log_TPM ?? NaN,
            format: (v) => formatNumber(v, 2),
        }),
        scale: () => null,
        help: { All: "Color Mode Help Text", Circadian: "Color Mode Help Text" },
    },

    circadian: {
        // Binary split is trivial when every gene shown is circadian
        availableIn: ["All"],
        fallback: "qval",
        metric: (ctx) => ({
            label: "−log10 q (MetaCycle)",
            short: "MetaCycle q",
            valueOf: (GeneID) => negLog10(ctx.data.meta.get(GeneID)?.metacycle_qval),
            format: fromNegLog10,
        }),
        scale: () => ({
            categories: [
                { label: `q ≤ ${QVAL_CUTOFF}`, color: PALETTE.teal, test: (v) => v >= -Math.log10(QVAL_CUTOFF) },
                { label: `q > ${QVAL_CUTOFF}`, color: THEME.pointActive, test: () => true },
            ],
        }),
        help: {
            All: "Binary cutoff with q-value of 0.01. Circadian is <= 0.01",
            Circadian: "Binary cutoff with q-value of 0.01. Circadian is <= 0.01",
        },
    },

    qval: {
        metric: (ctx) => {
            const field = qvalField(ctx.displayMode)
            const source = ctx.displayMode === "Circadian" ? "MetaCycle" : "LS"
            return {
                label: `−log10 q (${source})`,
                short: `${source} q`,
                valueOf: (GeneID) => negLog10(ctx.data.meta.get(GeneID)?.[field]),
                format: fromNegLog10,
            }
        },
        // Fixed domain: absolute significance, comparable across gene sets
        scale: (ctx) => ({
            interpolator: d3.interpolateInferno,
            domain: [0, QVAL_NEGLOG10_MAX],
            leftLabel: "1",
            rightLabel: `1e-${QVAL_NEGLOG10_MAX}`,
            title: ctx.displayMode === "Circadian" ? "−log₁₀ MetaCycle q" : "−log₁₀ LS q",
        }),
        help: {
            All: "How confident we are that a gene is oscillating. A q-value cut off of 0.01 would mean a 1% false discovery rate when calling an oscillating gene.",
            Circadian: "How confident we are that a gene is oscillating around 20~28hrs (Circadian). A q-value cut off of 0.01 would mean a 1% false positive rate when calling a circadian gene.",
        },
    },

    phase: {
        metric: (ctx) => {
            const field = phaseField(ctx.displayMode)
            const isRawPeak = field === PEAK_HOUR_FIELD
            return {
                label: isRawPeak ? "peak hour (h)" : "MetaCycle peak (h)",
                short: isRawPeak ? "peak hour" : "MetaCycle peak",
                valueOf: (GeneID) => ctx.data.meta.get(GeneID)?.[field] ?? NaN,
                format: (v) => withUnit(formatNumber(v, isRawPeak ? 0 : 2), " h"),
                levels: isRawPeak ? EXP_HOURS : null, // the raw peak can only be a sample hour
            }
        },
        scale: (ctx, values) => {
            const [lo, hi] = extentOrFallback(values, 0, 48)
            return {
                interpolator: d3.interpolateTurbo,
                domain: [lo, hi],
                leftLabel: `${formatLegendNum(lo, 1)}h`,
                rightLabel: `${formatLegendNum(hi, 1)}h`,
                title: ctx.displayMode === "Circadian" ? "MetaCycle peak" : "peak hour",
            }
        },
        help: {
            All: "The sample hour at which the gene's measured expression is highest.",
            Circadian: "Within the detected period (20~28 hrs), the hour at which the fitted MetaCycle curve peaks.",
        },
    },

    energyPct: {
        metric: (ctx) => {
            const period = ctx.options.energyPeriod
            const specs = ctx.data.specs[ctx.displayMode]
            return {
                label: `% ${formatLegendNum(period, 1)}h energy`,
                short: "energy",
                valueOf: (GeneID) => energyPctAtPeriod(GeneID, specs, period) ?? NaN,
                format: (v) => withUnit(formatNumber(v, 1), "%"),
            }
        },
        // All genes: fixed 0–100%. Circadian: shares bunch up (e.g. 24h mostly high),
        // so stretch the colors up to the largest share on the map
        scale: (ctx, values) => {
            const hi = ctx.displayMode === "Circadian" ? extentOrFallback(values, 0, 100)[1] : 100
            return {
                interpolator: d3.interpolateViridis,
                domain: [0, hi],
                leftLabel: "0%",
                rightLabel: `${formatLegendNum(hi, 1)}%`,
                title: `% ${formatLegendNum(ctx.options.energyPeriod, 1)}h energy`,
            }
        },
        help: {
            All: "% composition of the selected frequency component",
            Circadian: "% composition of the selected frequency component",
        },
    },

    waveConf: {
        // Needs a GP fit
        availableIn: ["Circadian"],
        fallback: "none",
        metric: (ctx) => ({
            label: "relative std",
            short: "relative std",
            valueOf: (GeneID) => ctx.data.gp.get(GeneID)?.relative_std ?? NaN,
            format: (v) => formatNumber(v, 3),
        }),
        // Long right tail (most genes ~0.2-0.5, a few up to ~3): top of the scale is the 98th
        // percentile and saturates above. Reversed so bright = confident fit, like "more" elsewhere
        scale: (ctx, values) => {
            const sorted = [...values].sort(d3.ascending)
            const [lo, hi] = extentOrFallback([sorted[0], d3.quantileSorted(sorted, 0.98)], 0, 1)
            return {
                interpolator: (t) => d3.interpolateCividis(1 - t),
                domain: [lo, hi],
                leftLabel: formatLegendNum(lo, 2),
                rightLabel: `≥${formatLegendNum(hi, 2)}`,
                title: "GP relative std",
            }
        },
        help: { All: "", Circadian: 'A metric for "spread" of the sampled wave.' },
    },
}

export function isModeAvailable(mode, displayMode) {
    const def = COLOR_MODES[mode]
    return Boolean(def) && (!def.availableIn || def.availableIn.includes(displayMode))
}

/** The mode to show for this gene set: the mode itself, or its fallback when it isn't available. */
export function modeForGeneSet(mode, displayMode) {
    return isModeAvailable(mode, displayMode) ? mode : (COLOR_MODES[mode]?.fallback ?? "none")
}
