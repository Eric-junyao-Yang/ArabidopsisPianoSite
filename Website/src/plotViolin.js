import { PALETTE, THEME, drawAxis, axisLabel } from "/src/plotTheme.js"

export function plotViolin(width, height, margin = {top: 20, right: 20, bottom: 20, left: 50}, 
    Arr, d3_select_div, y_lab, bus, execute_event = ""){

    const innerWidth = width - margin.left - margin.right
    const innerHeight = height - margin.top - margin.bottom

    const svg = d3_select_div
        .append("svg")
            .attr("width", width)
            .attr("height", height)
    
    const plotArea = svg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`)
    
    const yScale = d3.scaleLinear()
        .domain(d3.extent(Arr))
        .range([innerHeight, 0])
        .nice()
    
    drawAxis(plotArea.append("g"), d3.axisLeft(yScale).ticks(Math.max(4, Math.floor(innerHeight / 50))).tickSizeOuter(0))
    axisLabel(plotArea.append("text")
        .attr("transform", "rotate(90)")
        .attr("x", innerHeight/2)
        .attr("y", 40))
        .text(y_lab)

    const histogram = d3.histogram()
        .domain(yScale.domain())
        .thresholds(yScale.ticks(20))

    const bins = histogram(Arr)   
    const binScale = d3.scaleLinear()
        .domain([0, d3.max(bins, d => d.length)])
        .range([0, innerWidth])

    const curveDat = bins.map(d => ({
        y: yScale((d.x0 + d.x1)/2 ),
        x: binScale(d.length) 
    }))

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

    // Add quantile
    function widthAtY(y) {
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
        .on("dblclick", () => {
            [low_val, high_val] = [ymin, ymax]
            updateScrubber(true)
        })

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
        .style('cursor', 'ns-resize')
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
        .style('cursor', 'ns-resize')
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
        high_val = Math.min(
            ymax, Math.max(
                low_val,
                yScale.invert(event.y)
            )
        )
        updateScrubber()
    }))

    scrubber_handle_bot.call(d3.drag().on("drag", (event) => {
        low_val = Math.max(
            ymin, Math.min(
                high_val,
                yScale.invert(event.y)
            )
        )
        updateScrubber()
    }))

    scrubber_rect.call(d3.drag().on("drag", (event) => {
        const window_height = high_val - low_val
        high_val = Math.min(
            ymax, Math.max(
                ymin + window_height,
                high_val - (ymax - yScale.invert(event.dy))
            )
        )

        low_val = high_val - window_height

        if (low_val < ymin) {
            low_val = ymin
            high_val = ymin + window_height
        }
        
        updateScrubber()
    }))
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