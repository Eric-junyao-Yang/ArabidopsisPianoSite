/**
 * Energy spectra, one per gene set, built once in main.js:
 *   specs[displayMode] = { periods, byGene: Map(GeneID → [{ period, energyPct }]) }
 *   period    — oscillation period in hours (All: 48/k, Circadian: 24/k, k = 1..8)
 *   energyPct — the harmonic's share of the gene's oscillation energy (no DC), in %
 */

import {
    PALETTE,
    THEME,
    drawAxis,
    containerSize,
    onResize,
} from "./plotTheme.js"
import { FADE_TIME, SAMPLE_COLORS } from "./plotWaveforms.js"

/** rows: [{ period, energy }] → [{ period, energyPct }], shares summing to 100. */
export function toEnergyPct(rows) {
    const total = rows.reduce((sum, d) => sum + d.energy, 0)
    return rows.map((d) => ({
        period: d.period,
        energyPct: total > 0 ? (d.energy / total) * 100 : 0,
    }))
}

// Periods like 48/7 and radio values like "6.9" won't compare with ===
const samePeriod = (a, b) => Math.abs(a - b) < 0.05

export function hasPeriod(spec, periodHours) {
    return spec.periods.some((p) => samePeriod(p, Number(periodHours)))
}

export function energyPctAtPeriod(geneId, spec, periodHours) {
    const bin = spec.byGene.get(geneId)?.find((d) => samePeriod(d.period, Number(periodHours)))
    return bin ? bin.energyPct : null
}

// cos / sin of k cycles over the window (k = 1..nHarmonics), per draw length. They depend only
// on the length, so they're built once instead of on every draw
const dftTableCache = new Map()
function dftTables(n, nHarmonics) {
    const key = `${n}:${nHarmonics}`
    if (!dftTableCache.has(key)) {
        const cos = []
        const sin = []
        for (let k = 1; k <= nHarmonics; k++) {
            const c = new Float64Array(n)
            const s = new Float64Array(n)
            for (let j = 0; j < n; j++) {
                const angle = (2 * Math.PI * k * j) / n
                c[j] = Math.cos(angle)
                s[j] = Math.sin(angle)
            }
            cos.push(c)
            sin.push(s)
        }
        dftTableCache.set(key, { cos, sin })
    }
    return dftTableCache.get(key)
}

/**
 * Energy % of one GP draw at each harmonic of its window. Direct DFT at just these bins:
 * multiplying by a probe wave and summing picks out the part of the draw at that frequency
 * (DC and other harmonics sum to 0), and re² + im² is its energy whatever its phase.
 * The draw must span exactly one period, and periods[i] = period / (i + 1) (SPECS.Circadian.periods).
 */
export function drawEnergyPct(draw, periods) {
    const { cos, sin } = dftTables(draw.length, periods.length)
    return toEnergyPct(periods.map((period, i) => {
        let re = 0
        let im = 0
        for (let j = 0; j < draw.length; j++) {
            re += draw[j] * cos[i][j]
            im -= draw[j] * sin[i][j]
        }
        return { period, energy: re * re + im * im }
    }))
}

export function plotHarmonics(specs, bus) {
    const container = document.getElementById("Harmonic_div")
    if (!container) return { drawSample() {} }

    const MARGINS = { top: 16, right: 12, bottom: 20, left: 28 }
    const FALLBACK_W = 1000
    const FALLBACK_H = 84

    let spectrum = []
    let innerWidth = 0
    let innerHeight = 0
    let displayMode = "All"
    let selectedGene = null

    // Log axis: the short-period harmonics (3, 3.4, 4 h) would pile up on a linear one
    const xScale = d3.scaleLog()
    let yScale = d3.scaleLinear().domain([0, 100])

    const svg = d3.select(container).append("svg")
        .attr("role", "img")
        .attr("aria-label", "Oscillation energy by period for the selected gene")

    const plotArea = svg.append("g").attr("class", "harmonics-plot")
    const xAxisG = plotArea.append("g").attr("class", "harmonics-axis harmonics-axis--x")
    const yAxisG = plotArea.append("g").attr("class", "harmonics-axis harmonics-axis--y")
    const barsG = plotArea.append("g").attr("class", "harmonics-bars")
    const drawsG = plotArea.append("g").attr("class", "harmonics-draws") // above the bars

    // Corner label instead of a rotated y-axis title (saves horizontal space).
    const yCornerLabel = plotArea.append("text")
        .attr("class", "harmonics-ylabel")
        .attr("text-anchor", "start")
        .attr("fill", THEME.muted)
        .attr("font-size", 9)
        .attr("font-weight", 600)
        .style("font-family", THEME.fontMono)
        .text("energy %")

    const emptyLabel = plotArea.append("text")
        .attr("class", "harmonics-empty")
        .attr("text-anchor", "middle")
        .attr("fill", THEME.muted)
        .attr("font-size", 10)
        .attr("font-weight", 500)
        .style("font-family", THEME.fontMono)
        .text("select a gene")

    function formatPeriodTick(period) {
        const n = Number(period)
        if (!Number.isFinite(n)) return ""
        return Number.isInteger(n) ? `${n}h` : `${n.toFixed(1)}h`
    }

    const periods = () => specs[displayMode].periods

    function layout() {
        const [width, height] = containerSize(container, FALLBACK_W, FALLBACK_H, 280, 64)
        innerWidth = Math.max(40, width - MARGINS.left - MARGINS.right)
        innerHeight = Math.max(24, height - MARGINS.top - MARGINS.bottom)

        svg.attr("viewBox", `0 0 ${width} ${height}`)
        plotArea.attr("transform", `translate(${MARGINS.left}, ${MARGINS.top})`)
        const [lo, hi] = d3.extent(periods())
        xScale.domain([lo * 0.9, hi * 1.1]).range([0, innerWidth])
        yScale.range([innerHeight, 0])

        xAxisG.attr("transform", `translate(0, ${innerHeight})`)
        yCornerLabel.attr("x", 0).attr("y", -4)
        emptyLabel.attr("x", innerWidth / 2).attr("y", innerHeight / 2 + 3)

        drawAxis(
            xAxisG,
            d3.axisBottom(xScale)
                .tickValues(periods())
                .tickSizeOuter(0)
                .tickFormat(formatPeriodTick),
        )
        xAxisG.selectAll(".tick text").attr("dy", "0.85em")
    }

    function render() {
        const maxPct = d3.max(spectrum, (d) => d.energyPct) ?? 0
        yScale = d3.scaleLinear()
            .domain([0, Math.max(maxPct, 1)])
            .range([innerHeight, 0])
            .nice()

        drawAxis(
            yAxisG,
            d3.axisLeft(yScale)
                .ticks(2)
                .tickSizeOuter(0)
                .tickFormat((d) => (d >= 10 ? d3.format(".0f")(d) : d3.format(".1f")(d))),
        )

        const hasData = spectrum.length > 0
        emptyLabel.attr("opacity", hasData ? 0 : 1)

        const barWidth = currentBarWidth()

        barsG.selectAll("rect.harmonics-bar")
            .data(spectrum, (d) => d.period)
            .join(
                (enter) => enter.append("rect")
                    .attr("class", "harmonics-bar")
                    .attr("rx", 1.5)
                    .attr("ry", 1.5),
                (update) => update,
                (exit) => exit.remove(),
            )
            .attr("x", (d) => xScale(d.period) - barWidth / 2)
            .attr("y", (d) => yScale(d.energyPct))
            .attr("width", barWidth)
            .attr("height", (d) => Math.max(0, yScale(0) - yScale(d.energyPct)))
            .attr("fill", PALETTE.indigo)
            .attr("opacity", hasData ? 0.92 : 0)
    }

    const currentBarWidth = () => Math.max(4, Math.min(10, innerWidth / (periods().length * 2.2)))

    // Ticks are placed with the current scales, so any change to them (gene, gene set, size) clears them
    function clearDraws() {
        drawsG.selectAll("*").interrupt().remove()
    }

    function updatePlot() {
        clearDraws()
        spectrum = (selectedGene && specs[displayMode].byGene.get(selectedGene)) || []
        render()
    }

    layout()
    render()
    onResize(container, () => {
        clearDraws()
        layout()
        render()
    })

    bus.subscribe_to("point_select", "harmonics", (geneId) => {
        selectedGene = geneId || null
        updatePlot()
    })

    // Different period ladder per gene set
    bus.subscribe_to("DisplayModeSet", "harmonics", (mode) => {
        displayMode = mode
        layout()
        updatePlot()
    })

    /**
     * One tick per harmonic at this draw's energy %, like the waveform draws: the previous set fades
     * out over FADE_TIME. Only GP draws (Circadian) span the 24 h window the periods assume.
     */
    function drawSample(draw, color = SAMPLE_COLORS[0]) {
        if (displayMode !== "Circadian" || !spectrum.length) return
        const pcts = drawEnergyPct(draw, periods())
        const yMax = yScale.domain()[1]
        const y = (d) => yScale(Math.min(d.energyPct, yMax)) // a draw can beat the mean's axis; pin it to the top
        const tickWidth = currentBarWidth() + 6

        drawsG.selectAll("g.current")
            .classed("current", false)
            .transition()
            .duration(FADE_TIME)
            .ease(d3.easeLinear)
            .attr("opacity", 0)
            .remove()

        drawsG.append("g")
            .attr("class", "current")
            .attr("opacity", 0.95)
            .selectAll("line")
            .data(pcts)
            .join("line")
            .attr("x1", (d) => xScale(d.period) - tickWidth / 2)
            .attr("x2", (d) => xScale(d.period) + tickWidth / 2)
            .attr("y1", y)
            .attr("y2", y)
            .attr("stroke", color)
            .attr("stroke-width", 2)
            .attr("stroke-linecap", "round")
    }

    return {
        drawSample
    }
}
