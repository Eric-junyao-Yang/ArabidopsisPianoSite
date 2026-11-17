import { createDayNightFrame, periodicCurve } from "/src/plots/dayNightFrame.js"
import { PALETTE } from "/src/plots/plotTheme.js"
import { EXP_HOURS } from "/src/GaussianProcess/GPalgo.js"

/**
 * TOC1 (circadian) next to PP2AA3 (housekeeping) over the 48 h experiment.
 * Each gene is centred on its own mean so the plot compares how much they swing, not their baseline.
 * @param {HTMLElement} host
 * @param {{TOC1: ArrayLike<number>, PP2AA3: ArrayLike<number>}} genes  16 VST values each, at EXP_HOURS
 */
export function plotExpressionExplainer(host, { TOC1, PP2AA3 }) {
    host.replaceChildren()

    const series = [
        { name: "TOC1", values: TOC1, color: PALETTE.rose },
        { name: "PP2AA3", values: PP2AA3, color: PALETTE.teal },
    ].map((s) => {
        const mean = d3.mean(s.values)
        const centred = Array.from(s.values, (v) => v - mean)
        return {
            ...s,
            points: centred.map((y, i) => ({ x: EXP_HOURS[i], y })),
            curve: periodicCurve(centred),
        }
    })

    const { chart, xScale, yScale, innerWidth, line, setYDomain } = createDayNightFrame(host, {
        height: 320,
        margin: { top: 22, left: 56, bottom: 36, right: 72 }, // right: room for the gene labels
        yLabel: "VST − gene mean",
        ariaLabel: "TOC1 and PP2AA3 expression over 48 hours",
    })
    setYDomain(d3.extent(series.flatMap((s) => s.curve), (d) => d.y))

    // One group per gene: curve under its measured points, name at the right edge
    const genes = chart.selectAll("g.gene")
        .data(series)
        .join("g")
        .attr("class", "gene")

    genes.append("path")
        .attr("fill", "none")
        .attr("stroke", (s) => s.color)
        .attr("stroke-width", 2)
        .attr("opacity", 0.7)
        .attr("d", (s) => line(s.curve))

    genes.selectAll("circle")
        .data((s) => s.points.map((p) => ({ ...p, color: s.color })))
        .join("circle")
        .attr("r", 4.5)
        .attr("fill", (d) => d.color)
        .attr("stroke", "#fff")
        .attr("stroke-width", 1.5)
        .attr("cx", (d) => xScale(d.x))
        .attr("cy", (d) => yScale(d.y))

    genes.append("text")
        .attr("x", innerWidth + 8)
        .attr("y", (s) => yScale(s.curve.at(-1).y))
        .attr("dy", "0.35em")
        .attr("fill", (s) => s.color)
        .attr("font-size", 12)
        .attr("font-weight", 600)
        .text((s) => s.name)
}
