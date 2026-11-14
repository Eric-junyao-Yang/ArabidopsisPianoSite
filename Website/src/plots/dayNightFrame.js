import { PALETTE, THEME, styleAxis, axisLabel } from "/src/plots/plotTheme.js"
import { catmullrom } from "/src/catmullrom.js"
import { EXP_HOURS } from "/src/GaussianProcess/GPalgo.js"

export const EXPERIMENT_HOURS = 48
const SAMPLE_SPACING = EXP_HOURS[1] - EXP_HOURS[0] // 3 h between time points
// 16 h light / 8 h dark, twice
const LIGHT_BANDS = [[0, 16, "light"], [16, 24, "dark"], [24, 40, "light"], [40, 48, "dark"]]

/**
 * Empty 48 h light/dark chart: shading, axes and labels. Callers draw their data into `chart`;
 * anything appended there sits above the shading.
 * @returns {{ svg, chart, xScale, yScale, innerWidth, innerHeight, line, setYDomain }}
 *   line: d3.line for points shaped { x: hours, y }
 *   setYDomain(domain): rescale y (niced) and redraw the y axis
 */
export function createDayNightFrame(host, {
    width = 1000,
    height = 200,
    margin = { top: 22, left: 56, bottom: 36, right: 16 },
    yLabel = "expression (VST)",
    ariaLabel = "Expression over 48 hours",
} = {}) {
    const innerWidth = width - margin.left - margin.right
    const innerHeight = height - margin.top - margin.bottom

    // viewBox: fixed drawing coordinates, scaled to the container width by CSS
    const svg = d3.select(host).append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("preserveAspectRatio", "xMidYMid meet")
        .attr("role", "img")
        .attr("aria-label", ariaLabel)

    const chart = svg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`)

    const xScale = d3.scaleLinear().domain([0, EXPERIMENT_HOURS]).range([0, innerWidth])
    const yScale = d3.scaleLinear().domain([-1, 1]).range([innerHeight, 0])

    // Shading first so data sits on top
    const shade = chart.append("g").attr("class", "light-dark")
    for (const [x0, x1, phase] of LIGHT_BANDS) {
        const isLight = phase === "light"
        shade.append("rect")
            .attr("x", xScale(x0))
            .attr("y", 0)
            .attr("width", xScale(x1) - xScale(x0))
            .attr("height", innerHeight)
            .attr("fill", isLight ? PALETTE.sand : PALETTE.indigo)
            .attr("opacity", isLight ? 0.2 : 0.09)
        shade.append("text")
            .attr("x", xScale((x0 + x1) / 2))
            .attr("y", -7)
            .attr("text-anchor", "middle")
            .attr("fill", THEME.muted)
            .attr("font-size", 10)
            .attr("letter-spacing", "0.08em")
            .text(phase.toUpperCase())
    }

    const xAxis = chart.append("g")
        .attr("transform", `translate(0,${innerHeight})`)
        .call(d3.axisBottom(xScale).tickValues(EXP_HOURS).tickSizeOuter(0))
    styleAxis(xAxis)
    const yAxis = chart.append("g")

    axisLabel(chart.append("text"))
        .attr("x", innerWidth / 2)
        .attr("y", innerHeight + 32)
        .text("hours (ZT)")
    axisLabel(chart.append("text"))
        .attr("transform", "rotate(-90)")
        .attr("x", -innerHeight / 2)
        .attr("y", -(margin.left - 14))
        .text(yLabel)

    function setYDomain(domain) {
        yScale.domain(domain).nice()
        yAxis.call(d3.axisLeft(yScale).ticks(5).tickSizeOuter(0))
        styleAxis(yAxis)
    }
    setYDomain(yScale.domain())

    const line = d3.line()
        .x((d) => xScale(d.x))
        .y((d) => yScale(d.y))

    return { svg, chart, xScale, yScale, innerWidth, innerHeight, line, setYDomain }
}

/**
 * The periodic Catmull-Rom curve through 16 values at EXP_HOURS (2, 5, ..., 47 h), evaluated at
 * evenly spaced hours 0..48. Wraps from 47 h back to 2 h, like the wavetable the synth plays.
 * @returns {Array<{x: number, y: number}>}
 */
export function periodicCurve(values, nPoints = 256) {
    const n = values.length
    return d3.range(nPoints + 1).map((i) => {
        const x = (i * EXPERIMENT_HOURS) / nPoints
        const pos = (((x - EXP_HOURS[0]) / SAMPLE_SPACING) % n + n) % n
        const p1 = Math.floor(pos)
        const y = catmullrom(
            values[(p1 - 1 + n) % n],
            values[p1],
            values[(p1 + 1) % n],
            values[(p1 + 2) % n],
            pos - p1,
        )
        return { x, y }
    })
}
