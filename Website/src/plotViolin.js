export function plotViolin(width, height, margin = {top: 20, right: 20, bottom: 20, left: 50}, 
    Arr, d3_select_div, bus, execute_event = ""){

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
    
    const xScale = d3.scaleBand()
        .range([0, innerWidth])
        .domain([""])
    
    plotArea.append("g").call( d3.axisLeft(yScale) )
    plotArea.append("text")
        .attr("transform", "rotate(90)")
        .attr("x", + innerHeight/2)
        .attr("y", + 35)
        .attr("text-anchor", "middle")
        .attr("font-size", "12px")
        .text("log10(mean TPM)")

    const histogram = d3.histogram()
        .domain(yScale.domain())
        .thresholds(yScale.ticks(20))

    const bins = histogram(Arr)   
    const binScale = d3.scaleLinear()
        .domain([0, d3.max(bins, d => d.length)])
        .range([0, xScale.bandwidth()])

    const curveDat = bins.map(d => ({
        y: yScale((d.x0 + d.x1)/2 ),
        x: binScale(d.length) 
    }))

    const curve = d3.line()
        .x(d => d.x)
        .y(d => d.y)
        .curve(d3.curveCatmullRom)

    plotArea.append("path")
        .datum(curveDat)
        .style("stroke", "none")
        .style("fill", "pink")
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

    function plotQuantile(quant){
        const qval = quantile(Arr, quant)
        plotArea.append("line")
            .attr("stroke", "blue")
            .attr("stroke-width", 2)
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
    let [low_val, high_val] = [ymin, ymax] // log10(mean TPM)

    // rectangle
    const scrubber_rect = plotArea.append('rect')
        .attr('x', 0)
        .attr('y', 0)
        .attr('width', innerWidth)
        .attr('height', yScale(low_val) - yScale(high_val))
        .attr('stroke', 'none')
        .attr('fill', 'orange')
        .attr('opacity', 0.3)
        .attr('rx', 5)
        .on("dblclick", function(event){
            [low_val, high_val] = [ymin, ymax]
            updateScrubber(true)
        })

    // Top bar
    const SCRUBBER_HANDLES_HEIGHT = 6
    const scrubber_handle_top = plotArea.append('rect')
        .attr('x', 0)
        .attr('y', yScale(high_val) - SCRUBBER_HANDLES_HEIGHT / 2)
        .attr('width', innerWidth)
        .attr('height', SCRUBBER_HANDLES_HEIGHT)
        .attr('stroke', 'none')
        .attr('fill', 'orange')
        .attr('opacity', 0)
        
    // Bot bar
    const scrubber_handle_bot = plotArea.append('rect')
        .attr('x', 0)
        .attr('y', yScale(low_val) - SCRUBBER_HANDLES_HEIGHT / 2)
        .attr('width', innerWidth)
        .attr('height', SCRUBBER_HANDLES_HEIGHT)
        .attr('stroke', 'none')
        .attr('fill', 'orange')
        .attr('opacity', 0)
        
    // Circle Handles (visual only)
    const scrubber_top_circle = plotArea.append('circle')
        .attr('cx', innerWidth / 2)
        .attr('cy', yScale(high_val))
        .attr('r', 3)
        .attr('stroke', "none")
        .attr('fill', 'orange')
        .attr('pointer-events', 'none')
    const scrubber_bot_circle = plotArea.append('circle')
        .attr('cx', innerWidth / 2)
        .attr('cy', yScale(low_val))
        .attr('r', 3)
        .attr('stroke', "none")
        .attr('fill', 'orange')
        .attr('pointer-events', 'none')

    // scrubbing

    let current_filtered_gene_list = new Array()

    function areArraySame(a, b) {
        if (a.length !== b.length) return false
        const setA = new Set(a.map(x => x.id))
        const setB = new Set(b.map(x => x.id))
        if (setA.size !== setB.size) return false
        for (const id of setA) if (!setB.has(id)) return false
        return true
    }

    function updateScrubber(animate = false){
        const duration = animate ? 400 : 0

        const applyTransition = (selection) => 
            animate ? selection.transition().duration(duration).ease(d3.easeCubicOut) 
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

        bus.execute_event(execute_event, [high_val, low_val])
    }

    const dragTop = d3.drag().on("drag", (event) => {
        high_val = Math.min(
            ymax, Math.max(
                low_val,
                yScale.invert(event.y)
            )
        )
        updateScrubber()
    })

    const dragBot = d3.drag().on("drag", (event) => {
        low_val = Math.max(
            ymin, Math.min(
                high_val,
                yScale.invert(event.y)
            )
        )
        updateScrubber()
    })

    const dragRect = d3.drag().on("drag", (event) => {
        const window_height = high_val - low_val
        high_val = Math.min(
            ymax, Math.max(
                ymin + (high_val - low_val),
                high_val - (ymax - yScale.invert(event.dy))
            )
        )

        low_val = high_val - window_height

        if (low_val < ymin) {
            low_val = ymin
            high_val = ymin + window_height
        }
        
        updateScrubber()
    })
    scrubber_handle_top.call(dragTop)
    scrubber_handle_bot.call(dragBot)
    scrubber_rect.call(dragRect)
}

const quantile = (arr, q) => { //https://stackoverflow.com/questions/48719873/how-to-get-median-and-quartiles-percentiles-of-an-array-in-javascript-or-php
    const asc = arr => arr.sort((a, b) => a - b);
    // const new_arr = new Array(arr.length)
    // arr.map((val, idx) => {
    //     new_arr[idx] = val.log_mean_count
    // })
    const sorted = asc(arr);
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (sorted[base + 1] !== undefined) {
        return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
    } else {
        return sorted[base];
    }
}