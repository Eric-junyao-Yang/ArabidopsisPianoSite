import { PALETTE, THEME, drawAxis, axisLabel } from "./plotTheme.js"

/**
 * levels: optional sorted, evenly spaced values the data can take (e.g. the 16 sample hours).
 * When given, draws one bar per level instead of a smoothed violin, and the window snaps to whole bins.
 * horizontal: values run left → right and counts grow upward (phones). The plot is still drawn as the
 * vertical violin, inside a group mapped onto the screen, so only the axis is drawn differently.
 */
export function plotViolin(width, height, margin = {top: 20, right: 20, bottom: 20, left: 50}, 
    Arr, d3_select_div, y_lab, bus, execute_event = "", default_high = null, default_low = null,
    { levels = null, horizontal = false } = {}){

    // In the vertical drawing's terms: innerWidth = count extent, innerHeight = value extent
    const outerWidth = width - margin.left - margin.right
    const outerHeight = height - margin.top - margin.bottom
    const innerWidth = horizontal ? outerHeight : outerWidth
    const innerHeight = horizontal ? outerWidth : outerHeight

    const svg = d3_select_div
        .append("svg")
            .attr("width", width)
            .attr("height", height)
    
    const frame = svg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`)
    // Horizontal: drawing (x = count, y = value position) → screen (x = innerHeight - y, y = innerWidth - x),
    // so high values land on the right and counts rise from the bottom. d3.drag reports pointer
    // positions in this group's coordinates, so the drag handlers below work unchanged.
    const plotArea = horizontal
        ? frame.append("g").attr("transform", `matrix(0, -1, -1, 0, ${innerHeight}, ${innerWidth})`)
        : frame
    const resizeCursor = horizontal ? "ew-resize" : "ns-resize"
    
    // Discrete: each level owns a bin of width `step` centred on it
    const step = levels ? levels[1] - levels[0] : 0
    const yScale = d3.scaleLinear().range([innerHeight, 0])
    if (levels) yScale.domain([levels[0] - step / 2, levels.at(-1) + step / 2])
    else yScale.domain(d3.extent(Arr)).nice()

    // Axis and label sit outside the mapped group, so their text isn't mirrored
    const axisScale = horizontal ? yScale.copy().range([0, innerHeight]) : yScale
    const axisFor = horizontal ? d3.axisBottom : d3.axisLeft
    const valueAxis = levels
        ? axisFor(axisScale).tickValues(horizontal ? levels.filter((_, i) => i % 2 === 0) : levels)
        : axisFor(axisScale).ticks(Math.max(4, Math.floor(innerHeight / (horizontal ? 70 : 50))))
    const axisG = frame.append("g")
    if (horizontal) axisG.attr("transform", `translate(0, ${innerWidth})`)
    drawAxis(axisG, valueAxis.tickSizeOuter(0))
    if (horizontal) {
        axisLabel(frame.append("text")
            .attr("x", innerHeight / 2)
            .attr("y", innerWidth + 32)
            .attr("text-anchor", "middle"))
            .text(y_lab)
    } else {
        axisLabel(frame.append("text")
            .attr("transform", "rotate(90)")
            .attr("x", innerHeight/2)
            .attr("y", 40))
            .text(y_lab)
    }

    const histogram = d3.histogram()
        .domain(yScale.domain())
        .thresholds(levels ? levels.map((l) => l - step / 2).slice(1) : yScale.ticks(20))

    const bins = histogram(Arr)   
    const binScale = d3.scaleLinear()
        .domain([0, d3.max(bins, d => d.length)])
        .range([0, innerWidth])

    const curveDat = bins.map(d => ({
        y: yScale((d.x0 + d.x1)/2 ),
        x: binScale(d.length) 
    }))

    if (levels) {
        // One bar per level, with a gap so it reads as separate values, not a continuum
        const barHeight = (yScale(0) - yScale(step)) * 0.8
        plotArea.append("g")
            .selectAll("rect")
            .data(curveDat)
            .join("rect")
            .attr("x", 0)
            .attr("y", (d) => d.y - barHeight / 2)
            .attr("width", (d) => d.x)
            .attr("height", barHeight)
            .attr("rx", 2)
            .style("stroke", PALETTE.indigo)
            .style("stroke-width", 1)
            .style("stroke-opacity", 0.8)
            .style("fill", PALETTE.indigo)
            .style("fill-opacity", 0.18)
    } else {
        const curve = d3.area()
            .x0(0)
            .x1(d => d.x)
            .y(d => d.y)
            .curve(d3.curveCatmullRom)

        plotArea.append("path")
            .datum(curveDat)
            .style("stroke", PALETTE.indigo)
            .style("stroke-width", 1.25)
            .style("stroke-opacity", 0.8)
            .style("fill", PALETTE.indigo)
            .style("fill-opacity", 0.18)
            .attr("d", curve)
    }

    // Add quantile
    function widthAtY(y) {
        if (levels) { // bar length of the level the quantile falls on
            const value = yScale.invert(y)
            const bar = curveDat.find((d, i) => value >= bins[i].x0 && value <= bins[i].x1)
            return bar ? bar.x : 0
        }
        for (let i = 0; i < curveDat.length - 1; i++) {
            const a = curveDat[i];
            const b = curveDat[i + 1];

            if ((a.y >= y && b.y <= y) || (a.y <= y && b.y >= y)) {
                const t = (y - a.y) / (b.y - a.y);
                return a.x + t * (b.x - a.x);
            }
        }
        return 0;
    }

    const sortedArr = Arr.slice().sort((a, b) => a - b)
    function plotQuantile(quant){
        const qval = quantile(sortedArr, quant)
        plotArea.append("line")
            .attr("stroke", PALETTE.teal)
            .attr("stroke-width", 2)
            .attr("stroke-linecap", "round")
            .attr("x1", binScale(0))
            .attr("y1", yScale(qval))
            .attr("x2", widthAtY(yScale(qval)))
            .attr("y2", yScale(qval))
    }

    plotQuantile(0.25)
    plotQuantile(0.50)
    plotQuantile(0.75)

    // ----- Add Scrubber -----
    const [ymin, ymax] = yScale.domain()
    // Discrete: window edges sit on bin edges and the window always spans at least one bin
    const snap = (v) => levels ? ymin + Math.round((v - ymin) / step) * step : v
    const minWidth = levels ? step : 0
    let [low_val, high_val] = [ymin, ymax]

    // rectangle
    const scrubber_rect = plotArea.append('rect')
        .attr('x', 0)
        .attr('y', 0)
        .attr('width', innerWidth)
        .attr('height', yScale(low_val) - yScale(high_val))
        .attr('stroke', 'none')
        .attr('fill', PALETTE.sand)
        .attr('opacity', 0.35)
        .attr('rx', 4)
        .style('cursor', 'grab')
        .style('touch-action', 'none')

    // Double click anywhere on the plot (not just the window) resets to the full range
    svg.on("dblclick", () => setRange(ymin, ymax, { animate: true }))

    // Top bar
    const SCRUBBER_HANDLES_HEIGHT = 14 // generous hit area for touch
    const scrubber_handle_top = plotArea.append('rect')
        .attr('x', 0)
        .attr('y', yScale(high_val) - SCRUBBER_HANDLES_HEIGHT / 2)
        .attr('width', innerWidth)
        .attr('height', SCRUBBER_HANDLES_HEIGHT)
        .attr('stroke', 'none')
        .attr('fill', PALETTE.sand)
        .attr('opacity', 0)
        .style('cursor', resizeCursor)
        .style('touch-action', 'none')
        .on('mouseenter', function () { d3.select(this).attr('opacity', 0.5) })
        .on('mouseleave', function () { d3.select(this).attr('opacity', 0) })
        
    // Bot bar
    const scrubber_handle_bot = plotArea.append('rect')
        .attr('x', 0)
        .attr('y', yScale(low_val) - SCRUBBER_HANDLES_HEIGHT / 2)
        .attr('width', innerWidth)
        .attr('height', SCRUBBER_HANDLES_HEIGHT)
        .attr('stroke', 'none')
        .attr('fill', PALETTE.sand)
        .attr('opacity', 0)
        .style('cursor', resizeCursor)
        .style('touch-action', 'none')
        .on('mouseenter', function () { d3.select(this).attr('opacity', 0.5) })
        .on('mouseleave', function () { d3.select(this).attr('opacity', 0) })
        
    // Circle Handles (visual only)
    const scrubber_top_circle = plotArea.append('circle')
        .attr('cx', innerWidth / 2)
        .attr('cy', yScale(high_val))
        .attr('r', 4.5)
        .attr('stroke', THEME.ink)
        .attr('stroke-width', 1.5)
        .attr('fill', PALETTE.sand)
        .attr('pointer-events', 'none')
    const scrubber_bot_circle = plotArea.append('circle')
        .attr('cx', innerWidth / 2)
        .attr('cy', yScale(low_val))
        .attr('r', 4.5)
        .attr('stroke', THEME.ink)
        .attr('stroke-width', 1.5)
        .attr('fill', PALETTE.sand)
        .attr('pointer-events', 'none')

    // scrubbing
    function updateScrubber(animate = false){
        const applyTransition = (selection) => 
            animate ? selection.transition().duration(400).ease(d3.easeCubicOut) 
                    : selection

        applyTransition(scrubber_handle_top)
            .attr("y", yScale(high_val) - SCRUBBER_HANDLES_HEIGHT / 2)
        applyTransition(scrubber_handle_bot)
            .attr("y", yScale(low_val) - SCRUBBER_HANDLES_HEIGHT / 2)
        applyTransition(scrubber_top_circle)
            .attr("cy", yScale(high_val))
        applyTransition(scrubber_bot_circle)
            .attr("cy", yScale(low_val))
        applyTransition(scrubber_rect)
            .attr("y", yScale(high_val))
            .attr("height", yScale(low_val) - yScale(high_val))

        if (execute_event) {
            bus.execute_event(execute_event, [high_val, low_val])
        }
    }

    scrubber_handle_top.call(d3.drag().on("drag", (event) => {
        const next = Math.min(
            ymax, Math.max(
                low_val + minWidth,
                snap(yScale.invert(event.y))
            )
        )
        if (next === high_val) return
        high_val = next
        updateScrubber()
    }))

    scrubber_handle_bot.call(d3.drag().on("drag", (event) => {
        const next = Math.max(
            ymin, Math.min(
                high_val - minWidth,
                snap(yScale.invert(event.y))
            )
        )
        if (next === low_val) return
        low_val = next
        updateScrubber()
    }))

    // Window drag: shift by the pointer's total travel since grab, so snapping can step whole bins
    let dragStart = null
    scrubber_rect.call(d3.drag()
        .on("start", (event) => { dragStart = { y: event.y, low: low_val, high: high_val } })
        .on("drag", (event) => {
            const window_height = dragStart.high - dragStart.low
            let shift = yScale.invert(event.y) - yScale.invert(dragStart.y)
            if (levels) shift = Math.round(shift / step) * step
            const low = Math.max(ymin, Math.min(ymax - window_height, dragStart.low + shift))
            if (low === low_val) return
            low_val = low
            high_val = low + window_height
            updateScrubber()
        }))

    // Set the filter window from code (e.g. the demo); clamped to the plotted range
    function setRange(low, high, { animate = false } = {}) {
        low_val = Math.max(ymin, Math.min(ymax - minWidth, snap(low)))
        high_val = Math.max(low_val + minWidth, Math.min(ymax, snap(high)))
        updateScrubber(animate)
    }

    // apply default scrubber values
    if (default_high !== null && default_low !== null){
        setRange(default_low, default_high)
    }

    return { domain: [ymin, ymax], setRange, node: svg.node() }
}

/** Assumes arr is already sorted ascending. */
const quantile = (arr, q) => { //https://stackoverflow.com/questions/48719873/how-to-get-median-and-quartiles-percentiles-of-an-array-in-javascript-or-php
    const pos = (arr.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (arr[base + 1] !== undefined) {
        return arr[base] + rest * (arr[base + 1] - arr[base]);
    } else {
        return arr[base];
    }
}