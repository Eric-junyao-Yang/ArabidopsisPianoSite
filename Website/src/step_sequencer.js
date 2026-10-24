import { ldTimepoints } from "/src/catmullrom.js"

// --------- Plot period vs phase ---------
export function plotStepSeqMain(
    canvasWidth = 600, 
    canvasHeight = 400, 
    div_name = "#StepSequencer", 
    osc_perGene_meta, 
    osc_perGene_meta_lookup, 
    metaValues, 
    bus){
    const margin = {"top": 30, "right": 30, "bottom": 40,"left": 100, }
    const innerHeight = canvasHeight - margin.top - margin.bottom
    const innerWidth = canvasWidth - margin.left - margin.right
    const dpr = window.devicePixelRatio || 1
    const PADDING = 10
    const RADIUS_NORMAL = 3 // for plotting circles
    const RADIUS_HOVER = 4
    const RADIUS_SELECT = 5

    const xScale = d3.scaleLinear()
        .domain([0, 24])
        .range([0 + PADDING, innerWidth - PADDING])
        .nice()

    const yScale = d3.scaleLinear()
        .domain(d3.extent(osc_perGene_meta, d => d.period))
        .range([0, innerHeight])
        .nice()

    const container_div = d3.select(div_name)
        .style('width', canvasWidth + 'px')
        .style('height', canvasHeight + 'px')
        .style('position', 'relative')

    const svg = container_div.append('svg')
        .attr('width', canvasWidth)
        .attr('height', canvasHeight)
        .style('position', 'absolute')
        .style('pointer-events', 'none')

    const plotArea = svg.append('g')
        .attr('transform', `translate(${margin.left}, ${margin.top})`)

    const canvas = container_div.append('canvas')
        .attr('width', innerWidth * dpr)
        .attr('height', innerHeight * dpr)
        .style('width', innerWidth + 'px')
        .style('height', innerHeight + 'px')
        .style('position', 'absolute')
        .style('top', margin.top + 'px')
        .style('left', margin.left + 'px')

    const highlightCanvas = container_div.append('canvas')
        .attr('width', innerWidth * dpr)
        .attr('height', innerHeight * dpr)
        .style('width', innerWidth + 'px')
        .style('height', innerHeight + 'px')
        .style('position', 'absolute')
        .style('top', margin.top + 'px')
        .style('left', margin.left + 'px')
        .style('pointer-events', 'none')

    const CanvasCtx = canvas.node().getContext('2d', { willReadFrequently: true })
    CanvasCtx.scale(dpr,dpr)
    const HightlightCanvasCtx = highlightCanvas.node().getContext('2d')
    HightlightCanvasCtx.scale(dpr,dpr)

    function drawPoints(CanvasCtx, xSc, ySc, radius = RADIUS_NORMAL) {
        //Clear canvas
        CanvasCtx.clearRect(0, 0, innerWidth, innerHeight)

        CanvasCtx.fillStyle = "steelblue"
        CanvasCtx.beginPath()
        for (let i=0; i<osc_perGene_meta.length; i++){
            const d = osc_perGene_meta[i]
            CanvasCtx.moveTo(xSc(d.phase) + radius, ySc(d.period))
            CanvasCtx.arc(xSc(d.phase), ySc(d.period), radius, 0, 2*Math.PI)
        }
        CanvasCtx.fill()
    }
    drawPoints(CanvasCtx, xScale, yScale, RADIUS_NORMAL)

    function drawHighlight(HightlightCanvasCtx, xSc, ySc, hover_radius = RADIUS_HOVER, selected_radius = RADIUS_SELECT, show_all_phase = false) {
        HightlightCanvasCtx.clearRect(0, 0, innerWidth, innerHeight) //Clear canvas
        if (current_selection.size > 0) {
            current_selection.forEach((val) => {
                HightlightCanvasCtx.fillStyle = "pink"
                HightlightCanvasCtx.beginPath()
                HightlightCanvasCtx.moveTo(xSc(val.phase) + selected_radius, ySc(val.period))
                HightlightCanvasCtx.arc(xSc(val.phase), ySc(val.period), selected_radius, 0, 2*Math.PI)
                HightlightCanvasCtx.fill()
            })
        }
        // mouse down + drag show possible phases
        if (show_all_phase && drag_point) {
            const min_phase = drag_point.phase % drag_point.period
            let cur_phase = min_phase
            while (cur_phase < 24) {
                HightlightCanvasCtx.fillStyle = cur_phase === closest_point_to_drag ? "blue" : "red"
                HightlightCanvasCtx.beginPath()
                HightlightCanvasCtx.moveTo(xSc(cur_phase) + selected_radius, ySc(current_hover.period))
                HightlightCanvasCtx.arc(xSc(cur_phase), ySc(current_hover.period), selected_radius, 0, 2*Math.PI)
                HightlightCanvasCtx.fill()
                cur_phase += current_hover.period
            }
        }
        //hover highlight
        if (current_hover){
            HightlightCanvasCtx.fillStyle = "orange"
            HightlightCanvasCtx.beginPath()
            HightlightCanvasCtx.moveTo(xSc(current_hover.phase) + hover_radius, ySc(current_hover.period))
            HightlightCanvasCtx.arc(xSc(current_hover.phase), ySc(current_hover.period), hover_radius, 0, 2*Math.PI)
            HightlightCanvasCtx.fill()
        } else {return}
    }

    // ------------ draw piano ------------
    const pitchNames = [
        "A3", "A♯3/B♭3", "B3", 
        "C4", "C♯4/D♭4", "D4", "D♯4/E♭4", "E4", "F4", "F♯4/G♭4", "G4", "G♯4/A♭4", "A4", "A♯4/B♭4", "B4", 
        "C5", "C♯5/D♭5", "D5", "D♯5/E♭5", "E5", "F5", "F♯5/G♭5", "G5", "G♯5/A♭5", "A5", "A♯5/B♭5", "B5",
        "C6", "C♯6/D♭6", "D6", "D♯6/E♭6", "E6", "F6", "F♯6/G♭6", "G6", "G♯6/A♭6", "A6"
    ]
    
    const pitchTable = Array.from(pitchNames, (val, idx) => {
        const pitchCenter = 220*Math.pow(Math.pow(2, 1/12), idx)
        return {
            ['pitchName'] : val,
            ['pitchCenter'] : pitchCenter,
            // ['topEdge'] : pitchCenter * Math.pow(2, 1/24),
            // ['botEdge'] : pitchCenter / Math.pow(2, 1/24),
            ['keyColor'] : val.includes("/")? "black":"white",
        }
    })

    const halfSemi = Math.pow(2, 1/24)

    for (let i=0; i<pitchTable.length; i++){
        const key = pitchTable[i]

        if (key.keyColor === "black") {
            key.topEdge = key.pitchCenter * halfSemi
            key.botEdge = key.pitchCenter / halfSemi
            continue
        }

        const above = pitchTable[i + 1]
        const below = pitchTable[i - 1]

        if (above && above.keyColor === "black"){
            key.topEdge = key.pitchCenter * halfSemi * halfSemi
        } else {
            key.topEdge = key.pitchCenter * halfSemi
        }

        if (below && below.keyColor === "black") {
            key.botEdge = key.pitchCenter / (halfSemi * halfSemi)
        } else {
            key.botEdge = key.pitchCenter / halfSemi
        }
    }

    const WHITE_KEY_LENGTH = 30
    const BLACK_KEY_LENGTH = 20
    // set up clip-path
    svg.append('defs')
        .append('clipPath')
        .attr('id', 'left-axis-clip')
        .append('rect')
        .attr('x', 0)
        .attr('y', 0)
        .attr('width', WHITE_KEY_LENGTH + margin.left)
        .attr('height', innerHeight)
    const leftAxisandKeys = svg.append('g')
        .attr('transform', `translate(${margin.left - WHITE_KEY_LENGTH}, ${margin.top})`)
        .attr('clip-path', 'url(#left-axis-clip)')

    function drawPiano(pitchTable, ySc){

        const whiteKeys = pitchTable.filter(d => d.keyColor === 'white')
        const blackKeys = pitchTable.filter(d => d.keyColor === 'black')

        leftAxisandKeys.selectAll('.white-key')
            .data(whiteKeys, d=> d.pitchName)
            .join('rect')
            .attr('class', 'white-key')
            .attr("x", 0)
            .attr("y", d => ySc(10560/d.topEdge)) //10560 = 24hrs * 440 Hz scaling factor
            .attr("width", WHITE_KEY_LENGTH)
            .attr("height", d => ySc(10560/d.botEdge) - ySc(10560/d.topEdge))
            .attr("fill", "white")
            .attr("stroke", "black")
            .attr("stroke-width", "1")

        leftAxisandKeys.selectAll('.black-key')
            .data(blackKeys, d => d.pitchName)
            .join('rect')
            .attr('class', 'black-key')
            .attr("x", 0)
            .attr("y", d => ySc(10560/d.topEdge)) //10560 = 24hrs * 440 Hz scaling factor
            .attr("width", BLACK_KEY_LENGTH)
            .attr("height", d => ySc(10560/d.botEdge) - ySc(10560/d.topEdge))
            .attr("fill", "black")
            .attr("stroke", "black")
            .attr("stroke-width", "1")

        leftAxisandKeys.selectAll('.white-key-label')
            .data(whiteKeys, d => d.pitchName)
            .join('text')
            .attr('class', 'white-key-label')
            .attr('x', WHITE_KEY_LENGTH * 0.9)
            .attr('y', d => {
                const top = ySc(10560 / d.topEdge)
                const bot = ySc(10560 / d.botEdge)
                return top + (bot - top) * 0.5
            })
            .attr('text-anchor', 'end')
            .attr('dominant-baseline', 'middle')
            .attr('font-size', d => {
                const keyHeight = ySc(10560 / d.botEdge) - ySc(10560 / d.topEdge)
                return Math.min(keyHeight * 0.3, 20) + 'px'
            })
            .attr('fill', '#333')
            .attr('pointer-events', 'none')
            .text(d => d.pitchName)
    }

    drawPiano(pitchTable, yScale)
    // ------------ Scrubber --------------
    const SCRUBBER_HANDLE_WIDTH = 5
    const SCRUBBER_HANDLE_HEIGHT = 10
    const scrubber = plotArea.append('g')
    const scrubber_needle = scrubber.append('line')
        .attr("x1", xScale(0))
        .attr("y1", 0 - SCRUBBER_HANDLE_HEIGHT)
        .attr("x2", xScale(0))
        .attr("y2", innerHeight)
        .attr("stroke", "red")
        .attr("stroke-width", "2")
        .attr("stroke-linecap", "round")
    const scrubber_handle = scrubber.append('rect')
        .attr("x", xScale(0) - SCRUBBER_HANDLE_WIDTH/2)
        .attr("y", 0 - SCRUBBER_HANDLE_HEIGHT)
        .attr("width", SCRUBBER_HANDLE_WIDTH)
        .attr("height", SCRUBBER_HANDLE_HEIGHT)
        .attr("fill", "red")
        .attr("stroke", "red")
        .attr("stroke-width", "1")
    
    // Animate Scrubber
    let scrubber_time = 0
    let t_minus1 = null
    const scrubber_velocity = 3 //move horizontally n hrs per second
    function animateScrubber(t0){
        if (t_minus1){
            const dt = (t0 - t_minus1) / 1000
            const scrubber_time_tm1 = scrubber_time //to check if note is passed
            scrubber_time = (scrubber_time + dt * scrubber_velocity) % 24
            const scrubber_time_t0 = scrubber_time //to check if note is passed
            checkSelectedGenes(scrubber_time_tm1, scrubber_time_t0)
            const new_x = currentXScale(scrubber_time)
            scrubber.attr('transform', `translate(${new_x - PADDING},0)`) //if needle starts at 0 on scale, it needs to be shifted by padding for transform to work
            t_minus1 = t0
            if (isPlay){requestAnimationFrame(animateScrubber)} 
            else {t_minus1 = null}
        } else {
            t_minus1 = t0
            if (isPlay){requestAnimationFrame(animateScrubber)}
        }
    }
    
    // play pause cycle
    let isPlay = false
    function playPause(playState){
        isPlay = playState
        if (isPlay) {
            requestAnimationFrame(animateScrubber)
        }
    }

    function playStop(){
        isPlay = false
        scrubber_time = 0
        scrubber.attr('transform', `translate(0,0)`)
    }

    const period_to_freq_scaled = 440 / (1/24) // mapping 24 hours to 440Hz

    // ---------- Check if selected gene should be triggered ---------
    function checkSelectedGenes(tm1, t0) {
        // Scrubber wraps at 24 h: when tm1 > t0 the window crossed midnight
        current_selection.forEach((item) => {
            const xpos = item.phase
            const crossed = tm1 <= t0
                ? (xpos > tm1 && xpos <= t0)
                : (xpos > tm1 || xpos <= t0)
            if (!crossed) return

            const meta = osc_perGene_meta_lookup.get(item.GeneID)
            if (!meta) return
            const cur_freq = (1 / meta.period) * period_to_freq_scaled
            bus.execute_event("playNote", [
                metaValues,
                item.GeneID,
                meta.index,
                cur_freq,
                meta.sweep_frequency,
            ])
        })
    }

    // ---------- Set up Axis and labels -----------
    const xAxis = plotArea.append('g')
        .attr('transform', `translate(0, ${innerHeight})`)
        .call(d3.axisBottom(xScale))
    
    const yAxisLabel = svg.append('g')
        .attr('transform', `translate(${margin.left - WHITE_KEY_LENGTH}, ${margin.top})`)

    const yAxis = yAxisLabel.append("g") //use svg so it can be further left of plotArea
        .attr("transform", `translate(0, 0)`)
        .call(d3.axisLeft(yScale))
    
    plotArea.append("text")
        .attr("x", innerWidth / 2)
        .attr("y", innerHeight + 30)
        .attr("text-anchor", "middle")
        .attr("font-size", "12px")
        .text("Hours")

    yAxisLabel.append("text")
        .attr("transform", "rotate(-90)")
        .attr("x", - innerHeight/2)
        .attr("y", -30)
        .attr("text-anchor", "middle")
        .attr("font-size", "12px")
        .text("Period")

    plotArea.append("text")
        .attr("x", innerWidth / 2)
        .attr("y", -5)
        .attr("text-anchor", "middle")
        .attr("font-size", "15px")

    // Hover & selection control
    let quadtree = null
    let current_hover = null
    let current_selection = new Set()

    // special selection logic that preferentially returns selected points
    function findClosest(mx, my){
        let closest_selected = null
        let closest_selected_dist = Infinity

        current_selection.forEach(d => {
            const dx = currentXScale(d.phase) - mx
            const dy = currentYScale(d.period) - my
            const dist = Math.sqrt(dx*dx + dy*dy)
            if (dist <= RADIUS_SELECT && dist < closest_selected_dist){
                closest_selected = d
                closest_selected_dist = dist
            }
        })

        if (closest_selected) return closest_selected
        return quadtree.find(mx, my , RADIUS_HOVER)
    }

    function updatePoints(item){
        if (item){
            if (current_selection.has(item)) {
                bus.execute_event("selection_del", item)
            } else {
                bus.execute_event("selection_add", item)
            }
        }
    }


    function rebuildQuadtree(xSc, ySc) {
        quadtree = d3.quadtree()
            .x(d => xSc(d.phase))
            .y(d => ySc(d.period))
            .addAll(osc_perGene_meta)
    }

    rebuildQuadtree(xScale, yScale)

    let currentXScale = xScale
    let currentYScale = yScale

    // Zoom control
    let rafId = null
    const zoom = d3.zoom()
        .scaleExtent([1, 20])
        .extent([[0, 0], [innerWidth, innerHeight]])
        .on("zoom", (event) => {
            const zx = event.transform.rescaleX(xScale)
            const zy = event.transform.rescaleY(yScale)
            if (rafId) cancelAnimationFrame(rafId)
            rafId = requestAnimationFrame(() => {
                drawPoints(CanvasCtx, zx, zy, RADIUS_NORMAL)
                drawHighlight(HightlightCanvasCtx, zx, zy, RADIUS_HOVER, RADIUS_SELECT)
                drawPiano(pitchTable, zy)
                xAxis.call(d3.axisBottom(zx))
                yAxis.call(d3.axisLeft(zy))
                currentXScale = zx
                currentYScale = zy
            })
        })
        .on("end", (event) => {
            const zx = event.transform.rescaleX(xScale)
            const zy = event.transform.rescaleY(yScale)
            drawPoints(CanvasCtx, zx, zy, RADIUS_NORMAL)
            drawHighlight(HightlightCanvasCtx, zx, zy, RADIUS_HOVER, RADIUS_SELECT)
            drawPiano(pitchTable, zy)
            xAxis.call(d3.axisBottom(zx))
            yAxis.call(d3.axisLeft(zy))
            currentXScale = zx
            currentYScale = zy
            rebuildQuadtree(zx, zy)
        })
    
    zoom.filter((event) => {
        const startsPaning = event.type === "mousedown"
        if (startsPaning && current_hover) return false;

        return (!event.ctrlKey || event.type === "wheel") && !event.button //default
    })
    canvas.call(zoom)
    canvas.on('dblclick.zoom', null)
    canvas.on('dblclick', () => {
        canvas.transition().duration(500).call(zoom.transform, d3.zoomIdentity)
    })

    // Phase controls and displays + point select behavior
    let drag_point = null
    let mousedown = false
    let dragging = false
    let closest_point_to_drag = null
    let clicked_point = null

    function snapPhase(pointerX){
        const min_phase = drag_point.phase % drag_point.period
        let closest_phase = Infinity
        let closest_point = null
        for (let i=min_phase; i <= 24; i += drag_point.period) {
            const pointer_pos = currentXScale.invert(pointerX)
            const dist = Math.abs(pointer_pos - i)
            if (dist < closest_phase){
                closest_phase = dist
                closest_point = i
            }
        }
        return closest_point
    }

    canvas.on('pointerdown', (event) => {
        const [mx, my] = d3.pointer(event)
        clicked_point = findClosest(mx, my)
        mousedown = true
    })

    canvas.on('pointermove', (event) =>{
        if (mousedown) {
            dragging = true
            drag_point = clicked_point
        }

        if (!drag_point){ // hover behavior
            const [mx, my] = d3.pointer(event)
            const item = findClosest(mx, my)
            if (item !== current_hover){
                current_hover = item
                if (current_hover == null){
                    bus.execute_event("point_hover", null)
                } else {
                    bus.execute_event("point_hover", current_hover.GeneID)
                }
            } else {return}
        } else { // if dragging
            const pointerX = d3.pointer(event, canvas.node())[0]
            closest_point_to_drag = snapPhase(pointerX)
            drawHighlight(HightlightCanvasCtx, currentXScale, currentYScale, RADIUS_HOVER, RADIUS_SELECT, true)
        }
    })

    canvas.on('pointerup', (event) => {
        if (drag_point && closest_point_to_drag != null && drag_point.phase !== closest_point_to_drag) {
            drag_point.phase = closest_point_to_drag
            rebuildQuadtree(currentXScale, currentYScale)
            drawPoints(CanvasCtx, currentXScale, currentYScale, RADIUS_NORMAL)
        }
        if (clicked_point && !dragging){
            updatePoints(clicked_point)
        }
        drag_point = null
        dragging = false
        mousedown = false
        clicked_point = null
        closest_point_to_drag = null
    })

    //bus subscription
    bus.subscribe_to("point_hover", "mainplot", (current_hover) => {
        drawHighlight(HightlightCanvasCtx, currentXScale, currentYScale)
    })
    bus.subscribe_to("selection_add", "mainplot", (item) => {
        current_selection.add(item)
        bus.execute_event("selection_modified", current_selection)
    })
    bus.subscribe_to("selection_del", "mainplot", (item) => {
        current_selection.delete(item)
        bus.execute_event("selection_modified", current_selection)        
    })
    bus.subscribe_to("selection_modified", "mainplot", () => {
        drawHighlight(HightlightCanvasCtx, currentXScale, currentYScale)
    })
    bus.subscribe_to("seqPlayPause", "mainplot", (playState) => {
        playPause(playState)
    })
    bus.subscribe_to("seqStop", "mainplot", ()=> {
        playStop()
    })
    bus.subscribe_to("resetSelection", "mainplot", () => {
        current_selection = new Set()
        bus.execute_event("selection_modified", current_selection)
    })
}

export function plotStepSeqWave(width, height, div_name = "#SeqRightPlot"){
    const margin = {top: 50, right: 30, bot: 50, left: 60}
    const innerWidth = width - margin.left - margin.right
    const innerHeight = height - margin.top - margin.bot

    const div = d3.select(div_name)
        .style("width", width + "px")
        .style("height", height + "px")
        .style("position", "relative")

    div.selectAll('svg').remove()

    const svg = div.append('svg')
        .attr("width", width)
        .attr("height", height)
        .style("position", "relative")
    
    // const test = svg.append("rect")
    //     .attr("x", 0)
    //     .attr("y", 0)
    //     .attr("width", 30)
    //     .attr("height", 30)
    //     .attr("fill", "black")

    const plotArea = svg.append('g')
        .attr('transform', `translate(${margin.left}, ${margin.top})`)

    const xScale = d3.scaleLinear().range([0, innerWidth])
    const yScale = d3.scaleLinear().range([innerHeight, 0])

    // ---------- Set up Axis and labels -----------
    const xAxisG = plotArea.append('g')
        .attr("class", "x-axis")
        .attr("transform", `translate(0, ${innerHeight})`)
    
    const yAxisG = plotArea.append('g')
        .attr("class", "y-axis")
    
    plotArea.append("text")
        .attr("x", innerWidth / 2)
        .attr("y", innerHeight + 40)
        .attr("text-anchor", "middle")
        .attr("font-size", "12px")
        .text("Hours")
    
    plotArea.append("text")
        .attr("transform", "rotate(-90)")
        .attr("x", -innerHeight/2)
        .attr("y", -30)
        .attr("text-anchor", "middle")
        .attr("font-size", "12px")
        .text("VST expression")
    
    const titleText = plotArea.append("text")
        .attr("transform", `translate(${innerWidth/2},-10)`)
        .attr("text-anchor", "middle")
        .attr("font-size", "23px")

    const confIntGroup = plotArea.append("g").attr("class", "conf-int-group")
    const samplesGroup = plotArea.append("g").attr("class", "samples-group")
    const muGroup = plotArea.append("g").attr("class", "mu-group")
    const vstDotsGroup = plotArea.append("g").attr("class", "vst-dots-group")

    // default display
    function renderEmpty(){
        xScale.domain([0, 48])
        yScale.domain([0, 100])
        xAxisG.call(d3.axisBottom(xScale))
        yAxisG.call(d3.axisLeft(yScale))
        titleText.text("gene ID")

        confIntGroup.selectAll("*").remove()
        samplesGroup.selectAll("*").remove()
        muGroup.selectAll("*").remove()
        vstDotsGroup.selectAll("*").remove()
    }

    function updatePlot({ metaValues, shared, cur_mu: mu, cur_std: std, meta_item, VST_dat }) {
        if (!meta_item || !mu || !std || !VST_dat) return

        const base = meta_item.index * metaValues.BLOCK
        const period = meta_item.period
        // Inverse of peak-norm in load_waveforms (midrange center + half-range scale)
        const center = (meta_item.wave_max + meta_item.wave_min) / 2
        const scale = (meta_item.wave_max - meta_item.wave_min) / 2 || 1.0

        const sample_wavs = Array.from({ length: metaValues.N_SAMPLES }, (_, i) =>
            new Float32Array(shared, (base + metaValues.N_GRID * i) * 4, metaValues.N_GRID)
        )

        const bandLo = mu.map((m, i) => m - 2 * std[i])
        const bandHi = mu.map((m, i) => m + 2 * std[i])
        const plot_min = d3.min([...bandLo, meta_item.wave_min])
        const plot_max = d3.max([...bandHi, meta_item.wave_max])

        xScale.domain([0, period]).nice()
        yScale.domain([plot_min, plot_max]).nice()
        xAxisG.transition().duration(300).call(d3.axisBottom(xScale))
        yAxisG.transition().duration(300).call(d3.axisLeft(yScale))
        titleText.text(meta_item.GeneID)

        const mu_std_dat = Array.from({ length: metaValues.N_GRID }, (_, idx) => ({
            x: (idx * period) / metaValues.N_GRID,
            mu: mu[idx],
            std: std[idx],
        }))

        const area = d3.area()
            .x((d) => xScale(d.x))
            .y0((d) => yScale(d.mu + 2 * d.std))
            .y1((d) => yScale(d.mu - 2 * d.std))

        confIntGroup.selectAll("path")
            .data([mu_std_dat])
            .join("path")
            .attr("fill", "steelblue")
            .attr("opacity", 0.1)
            .attr("stroke", "none")
            .attr("d", (d) => area(d))

        const line_sample_wavs = d3.line()
            .x((_, i) => xScale((i * period) / metaValues.N_GRID))
            .y((d) => yScale(d * scale + center))

        const colors = d3.schemeTableau10
        samplesGroup.selectAll("path")
            .data(sample_wavs)
            .join("path")
            .attr("fill", "none")
            .attr("stroke", (_, i) => colors[i % 10])
            .attr("stroke-width", 3)
            .attr("opacity", 0.4)
            .attr("d", (dat) => line_sample_wavs(dat))

        const line_mu_wav = d3.line()
            .x((_, i) => xScale((i * period) / metaValues.N_GRID))
            .y((d) => yScale(d))

        muGroup.selectAll("path")
            .data([mu])
            .join("path")
            .attr("fill", "none")
            .attr("stroke", "red")
            .attr("stroke-width", 3)
            .attr("opacity", 0.6)
            .attr("d", (d) => line_mu_wav(d))

        // 16 VST observations, phase-folded onto [0, period)
        const vst_y = ldTimepoints(VST_dat)

        const vst_points = Array.from({ length: 16 }, (_, i) => ({
            x: ((i + 1) * 3 - 1) % period,
            y: vst_y[i],
        }))

        vstDotsGroup.selectAll("circle")
            .data(vst_points)
            .join("circle")
            .attr("r", 5)
            .attr("fill", "black")
            .attr("opacity", 0.6)
            .attr("cx", (d) => xScale(d.x))
            .attr("cy", (d) => yScale(d.y))
    }

    renderEmpty()

    return {renderEmpty, updatePlot}
}
