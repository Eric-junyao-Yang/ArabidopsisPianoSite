import {interpolate_waveform} from "/src/catmullrom.js"

export function plotGene(g, gene_dats, gene_names, opts = {
    width: 800, //650
    height: 300,
    margin: { top: 20, right: 200, bottom: 40, left: 50 },
}){
    
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
    const xAxis = chart.append('g')
        .attr('transform', `translate(0, ${innerHeight})`)
        .call(d3.axisBottom(xScale).tickValues(tickVals))
    const yAxis = chart.append("g")
        .attr("transform", `translate(0, 0)`)
        .call(d3.axisLeft(yScale))
    
    const xLab = chart.append('text')
        .attr('transform', `translate(${innerWidth/2}, ${innerHeight + 32 })`)
        .attr("text-anchor", "middle")
        .attr("font-size", "12px")
        .text("Time (h)")
    const yLab = chart.append('text')
        .attr("transform", "rotate(-90)")
        .attr("x", -innerHeight/2)
        .attr("y", -30)
        .attr("text-anchor", "middle")
        .attr("font-size", "12px")
        .text("Fold change relative to mean")

    chart.append("rect")
        .attr("x", xScale(0)).attr("y", 0)
        .attr("width", xScale(16)).attr("height", innerHeight)
        .attr("fill", "orange").attr("opacity", 0.3)
    chart.append("rect")
        .attr("x", xScale(24)).attr("y", 0)
        .attr("width", xScale(16)).attr("height", innerHeight)
        .attr("fill", "orange").attr("opacity", 0.3)
    chart.append("rect")
        .attr("x", xScale(16)).attr("y", 0)
        .attr("width", xScale(8)).attr("height", innerHeight)
        .attr("fill", "grey").attr("opacity", 0.3)
    chart.append("rect")
        .attr("x", xScale(40)).attr("y", 0)
        .attr("width", xScale(8)).attr("height", innerHeight)
        .attr("fill", "grey").attr("opacity", 0.3)
    
    const circle_colors = ["blue", "red"]
    const line_colors = ["steelblue", "salmon"]

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
            .attr("r", 3)
            .attr("fill", circle_colors[idx])
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
            .attr("stroke-width", 1)
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
        .text(d => d.gene_name != null ? `${d.id} (${d.gene_name})` : d.id)
    legendEach.merge(legend)
        .attr("transform", (d, i) => `translate(${innerWidth + 30}, ${innerHeight/2 - (5*gene_dats.length) + i * 20})`)
}


function extractDatAndNorm(dat){
    const raw_dat = dat
    const yVals = Object.keys(raw_dat)
        .filter(k => k.startsWith('LD_ZT'))
        .map(k => raw_dat[k])
    const mu = d3.mean(yVals)
    const sd = d3.deviation(yVals)
    const mean_center = yVals.map(x => (x / mu))
    return {
        raw_dat: yVals,
        mean_cent: mean_center,
        id: dat.id
    }
}