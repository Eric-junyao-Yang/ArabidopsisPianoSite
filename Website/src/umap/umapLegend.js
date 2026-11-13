import { PALETTE, THEME } from "/src/plotTheme.js"
import { QVAL_CUTOFF, continuousColorScale } from "/src/umap/umapColors.js"

function drawContinuousLegend(svg, legend, gradId, interpolator, leftLabel, rightLabel, title) {
    const barW = 88
    const barH = 10
    let defs = svg.select(":scope > defs")
    if (defs.empty()) defs = svg.insert("defs", ":first-child")
    defs.select(`#${gradId}`).remove()
    const grad = defs.append("linearGradient").attr("id", gradId)
        .attr("x1", "0%").attr("x2", "100%")
    const stops = 12
    for (let i = 0; i <= stops; i++) {
        const t = i / stops
        grad.append("stop")
            .attr("offset", `${t * 100}%`)
            .attr("stop-color", interpolator(t))
    }
    legend.append("rect")
        .attr("x", -barW - 8).attr("y", 0)
        .attr("width", barW).attr("height", barH)
        .attr("rx", 2)
        .attr("fill", `url(#${gradId})`)
    legend.append("text")
        .attr("x", -barW - 8).attr("y", barH + 11)
        .attr("fill", THEME.muted).attr("font-size", 9)
        .style("font-family", THEME.fontMono)
        .text(leftLabel)
    legend.append("text")
        .attr("x", -8).attr("y", barH + 11)
        .attr("text-anchor", "end")
        .attr("fill", THEME.muted).attr("font-size", 9)
        .style("font-family", THEME.fontMono)
        .text(rightLabel)
    legend.append("text")
        .attr("x", -8).attr("y", barH + 24)
        .attr("text-anchor", "end")
        .attr("fill", THEME.muted).attr("font-size", 9)
        .style("font-family", THEME.fontMono)
        .text(title)
    const filt = legend.append("g").attr("transform", `translate(0, ${barH + 38})`)
    filt.append("circle").attr("cx", -8).attr("cy", 0).attr("r", 4).attr("fill", THEME.pointInactive)
    filt.append("text")
        .attr("x", -16).attr("y", 0).attr("dy", "0.35em")
        .attr("text-anchor", "end")
        .attr("fill", THEME.muted).attr("font-size", 10)
        .style("font-family", THEME.fontMono)
        .text("filtered out")
}

/**
 * Draw / replace the UMAP color legend for the current color + display mode.
 * @param {{ svg, legend, div_name, umap_arr, metaByGene, specsLookup, displayMode }} ctx
 */
export function renderColorLegend(ctx, mode) {
    const { svg, legend, div_name, umap_arr, metaByGene, specsLookup, displayMode } = ctx
    legend.selectAll("*").remove()
    if (mode === "none") return

    if (mode === "circadian") {
        const items = [
            { label: `q ≤ ${QVAL_CUTOFF}`, color: PALETTE.teal },
            { label: `q > ${QVAL_CUTOFF}`, color: THEME.pointActive },
            { label: "filtered out", color: THEME.pointInactive },
        ]
        items.forEach((item, i) => {
            const row = legend.append("g").attr("transform", `translate(0, ${i * 14})`)
            row.append("circle").attr("cx", -8).attr("cy", 0).attr("r", 4).attr("fill", item.color)
            row.append("text")
                .attr("x", -16).attr("y", 0).attr("dy", "0.35em")
                .attr("text-anchor", "end")
                .attr("fill", THEME.muted)
                .attr("font-size", 10)
                .style("font-family", THEME.fontMono)
                .text(item.label)
        })
        return
    }

    const scale = continuousColorScale(mode, umap_arr, metaByGene, specsLookup, displayMode)
    if (!scale) return
    drawContinuousLegend(
        svg,
        legend,
        `umap-${scale.gradIdSuffix}-grad-${div_name}`,
        scale.interpolator,
        scale.leftLabel,
        scale.rightLabel,
        scale.title,
    )
}
