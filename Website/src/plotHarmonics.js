/**
 * Clarification:
 *   amplitudeSpectrum  = raw FFT coefficient magnitude (from per_gene_meta.spec*)
 *   energy     — amplitude**2
 *   energyShare = energy / total energy in [0, 1]
 *   energyPct   = energyShare * 100
 *   period      = oscillation period in hours (48, 24, …)
 */

import {
    PALETTE,
    THEME,
    drawAxis,
    containerSize,
    onResize,
} from "/src/plotTheme.js"

/** Harmonics 1..8 of a 48h fundamental → 48, 24, 16, … */
const TICK_PERIODS = [1, 2, 3, 4, 5, 6, 7, 8].map((k) => 48 / k)

export function spectrumToEnergyPct(amplitudeSpectrum) {
    if (!amplitudeSpectrum?.length) return []
    const totalEnergy = amplitudeSpectrum.reduce((sum, d) => sum + d.amplitude ** 2, 0)
    if (!(totalEnergy > 0)) {
        return amplitudeSpectrum.map((d) => ({ period: d.period, energyPct: 0 }))
    }
    return amplitudeSpectrum.map((d) => ({
        period: d.period,
        energyPct: (d.amplitude ** 2 / totalEnergy) * 100,
    }))
}

export function geneSpectrumEnergyPct(geneId, specsLookup) {
    const amplitudeSpectrum = specsLookup.get(geneId)
    if (!amplitudeSpectrum) return []
    return spectrumToEnergyPct(amplitudeSpectrum)
}

export function energyPctAtPeriod(geneId, specsLookup, periodHours) {
    const hours = typeof periodHours === "number" ? periodHours : parseInt(periodHours, 10)
    const bin = geneSpectrumEnergyPct(geneId, specsLookup)
        .find((d) => d.period === hours)
    return bin ? bin.energyPct : null
}

export function plotHarmonics(specsLookup, bus) {
    const container = document.getElementById("Harmonic_div")
    if (!container) return

    const MARGINS = { top: 16, right: 12, bottom: 20, left: 28 }
    const FALLBACK_W = 1000
    const FALLBACK_H = 84

    let spectrum = []
    let innerWidth = 0
    let innerHeight = 0

    const xScale = d3.scaleLinear().domain([5, 50])
    let yScale = d3.scaleLinear().domain([0, 100])

    const svg = d3.select(container).append("svg")
        .attr("role", "img")
        .attr("aria-label", "Oscillation energy by period for the selected gene")

    const plotArea = svg.append("g").attr("class", "harmonics-plot")
    const xAxisG = plotArea.append("g").attr("class", "harmonics-axis harmonics-axis--x")
    const yAxisG = plotArea.append("g").attr("class", "harmonics-axis harmonics-axis--y")
    const barsG = plotArea.append("g").attr("class", "harmonics-bars")

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

    function layout() {
        const [width, height] = containerSize(container, FALLBACK_W, FALLBACK_H, 280, 64)
        innerWidth = Math.max(40, width - MARGINS.left - MARGINS.right)
        innerHeight = Math.max(24, height - MARGINS.top - MARGINS.bottom)

        svg.attr("viewBox", `0 0 ${width} ${height}`)
        plotArea.attr("transform", `translate(${MARGINS.left}, ${MARGINS.top})`)
        xScale.range([0, innerWidth])
        yScale.range([innerHeight, 0])

        xAxisG.attr("transform", `translate(0, ${innerHeight})`)
        yCornerLabel.attr("x", 0).attr("y", -4)
        emptyLabel.attr("x", innerWidth / 2).attr("y", innerHeight / 2 + 3)

        drawAxis(
            xAxisG,
            d3.axisBottom(xScale)
                .tickValues(TICK_PERIODS)
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

        const barWidth = Math.max(4, Math.min(10, innerWidth / (TICK_PERIODS.length * 2.2)))

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

    function updatePlot(energyPctSpectrum) {
        spectrum = energyPctSpectrum ?? []
        render()
    }

    layout()
    render()
    onResize(container, () => {
        layout()
        render()
    })

    bus.subscribe_to("point_select", "harmonics", (geneId) => {
        if (!geneId) {
            updatePlot([])
            return
        }
        updatePlot(geneSpectrumEnergyPct(geneId, specsLookup))
    })
}
