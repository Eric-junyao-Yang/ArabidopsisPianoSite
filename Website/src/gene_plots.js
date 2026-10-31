import { interpolate_waveform, ldTimepoints } from "/src/catmullrom.js"
import { PALETTE, THEME, drawAxis, axisLabel } from "/src/plotTheme.js"

export function plotGene(g, gene_dats, gene_names, opts = {
    width: 800,
    height: 300,
    margin: { top: 20, right: 200, bottom: 40, left: 50 },
}) {
    const gene_dat_norms = gene_dats.map(extractDatAndNorm)
    const width = opts.width
    const height = opts.height
    const margin = opts.margin

    const innerWidth = width - margin.left - margin.right
    const innerHeight = height - margin.top - margin.bottom
    const xScale = d3.scaleLinear()
        .domain([0, 48])
        .range([0, innerWidth])
    const yScale = d3.scaleLinear()
        .domain(d3.extent(gene_dat_norms.flatMap(result => result.mean_cent)))
        .range([innerHeight, 0])
        .nice()

    const chart = g.append('g').attr("transform", `translate(${margin.left}, ${margin.top})`)

    const tickVals = d3.range(16).map(i => 2 + 3 * i)
    // Day/night shading goes first so grid, axes and data sit on top of it.
    // Light = warm sand, dark = cool indigo tint: separable without relying on hue alone.
    const shade = (x0, x1, color, opacity) => chart.append("rect")
        .attr("x", xScale(x0)).attr("y", 0)
        .attr("width", xScale(x1) - xScale(x0)).attr("height", innerHeight)
        .attr("fill", color).attr("opacity", opacity)
    shade(0, 16, PALETTE.sand, 0.28)
    shade(24, 40, PALETTE.sand, 0.28)
    shade(16, 24, PALETTE.indigo, 0.12)
    shade(40, 48, PALETTE.indigo, 0.12)

    chart.append("g").attr("class", "grid")
        .selectAll("line")
        .data(yScale.ticks(5))
        .join("line")
        .attr("x1", 0).attr("x2", innerWidth)
        .attr("y1", d => yScale(d)).attr("y2", d => yScale(d))
        .attr("stroke", THEME.grid)
        .attr("stroke-width", 1)

    const xAxis = drawAxis(chart.append('g')
        .attr('transform', `translate(0, ${innerHeight})`),
        d3.axisBottom(xScale).tickValues(tickVals).tickSizeOuter(0))
    const yAxis = drawAxis(chart.append("g")
        .attr("transform", `translate(0, 0)`),
        d3.axisLeft(yScale).ticks(5).tickSizeOuter(0))
    
    const xLab = axisLabel(chart.append('text')
        .attr('transform', `translate(${innerWidth/2}, ${innerHeight + 34 })`))
        .text("Time (h)")
    const yLab = axisLabel(chart.append('text')
        .attr("transform", "rotate(-90)")
        .attr("x", -innerHeight/2)
        .attr("y", -36))
        .text("Fold change relative to mean")

    // Housekeeping gene = indigo, circadian gene = rose (colorblind-safe pair)
    const circle_colors = [PALETTE.indigo, PALETTE.rose]
    const line_colors = [PALETTE.indigo, PALETTE.rose]

    // Draw circle and line for each series
    gene_dat_norms.forEach( (result, idx) => {
        const gene_id = result.id
        const gene_dat_norm = result.mean_cent
        const unique_class_idx = `series-${idx}`

        const circles_TOC = chart.selectAll(`circle.TOC.${unique_class_idx}`).data(gene_dat_norm, (d, i) => i)
        circles_TOC.exit().remove()
        circles_TOC.enter()
            .append("circle")
            .attr("class", `TOC ${unique_class_idx}`)
            .attr("r", 3.5)
            .attr("fill", circle_colors[idx])
            .attr("stroke", "#fff")
            .attr("stroke-width", 1.25)
            .merge(circles_TOC)
            .attr("cx", (d, i) => xScale(2 + 3 * i))
            .attr("cy", d => yScale(d))
        
        // smooth curve
        var interp_points_TOC = interpolate_waveform(gene_dat_norm, 2000)
        interp_points_TOC = interp_points_TOC.map((value, i) => ({pos: i * (16 / 2000), value})).filter(d => d.pos <= 16 -1)
        const lineGen = d3.line()
            .x((d, i) => xScale(2 + 3 * d.pos))
            .y(d => yScale(d.value))
            .curve(d3.curveLinear)
        const path_TOC = chart.selectAll(`path.TOC.${unique_class_idx}`).data([interp_points_TOC])

        path_TOC.enter()
            .append("path")
            .attr("class", `TOC ${unique_class_idx}`)
            .attr("fill", "none")
            .attr("stroke", line_colors[idx])
            .attr("stroke-width", 2)
            .attr("stroke-linejoin", "round")
            .attr("opacity", 0.9)
            .merge(path_TOC)
            .attr("d", lineGen)
    })
    // Draw Legends
    const legendDat = gene_dat_norms.map((v, i) => ({
        id: v.id,
        cir_color: circle_colors[i],
        lin_color: line_colors[i],
        gene_name: gene_names? gene_names[i] : null,
    }))
    const legend = chart.selectAll("g.legend-item")
        .data(legendDat, d => d.id) // the mapping here sets the name of each item using the id as unique name
    
    legend.exit().remove()

    const legendEach = legend.enter()
        .append("g")
        .attr("class", "legend-item")
    legendEach.append("line")
        .attr("x1", 0)
        .attr("x2", 20)
        .attr("y1", 0)
        .attr("y2", 0)
        .attr("stroke-width", 2)
        .attr("stroke", d => d.lin_color)
    legendEach.append("circle")
        .attr("cx", 10)
        .attr("cy", 0)
        .attr("r", 3)
        .attr("fill", d => d.cir_color)
    legendEach.append("text")
        .attr("x", 25)
        .attr("y", 5)
        .attr("font-size", "12px")
        .attr("fill", THEME.ink)
        .text(d => d.gene_name != null ? `${d.id} (${d.gene_name})` : d.id)
    legendEach.merge(legend)
        .attr("transform", (d, i) => `translate(${innerWidth + 30}, ${innerHeight/2 - (5*gene_dats.length) + i * 20})`)
}


function extractDatAndNorm(dat) {
    const yVals = ldTimepoints(dat)
    const mu = d3.mean(yVals) || 1
    return {
        raw_dat: yVals,
        mean_cent: yVals.map((x) => x / mu),
        id: dat.GeneID,
    }
}