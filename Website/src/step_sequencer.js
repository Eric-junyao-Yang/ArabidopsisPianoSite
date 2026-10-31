import { ldTimepoints } from "/src/catmullrom.js"
import { PALETTE, THEME, withAlpha, drawAxis, axisLabel, plotTitle } from "/src/plotTheme.js"

// Point colors shared by the main plot: indigo = passes filters, grey = filtered out,
// teal = hover, rose = in the play list, sand = in focus (matches the UMAP highlight colors).
const PT_ACTIVE = withAlpha(PALETTE.indigo, 0.6)
const PT_INACTIVE = withAlpha(THEME.pointInactive, 0.35)

// --------- Plot period vs phase ---------
export function plotStepSeqMain(
    canvasWidth = 600, 
    canvasHeight = 400, 
    div_name = "#StepSequencer", 
    osc_perGene_meta, 
    osc_perGene_meta_lookup, 
    metaValues, 
    bus){
    // Size to the container at load (width), keeping a pleasant aspect ratio; given size = max.
    const host = document.querySelector(div_name)
    const hostW = host?.clientWidth || canvasWidth
    canvasWidth = Math.max(320, Math.min(canvasWidth, Math.floor(hostW)))  // clientWidth excludes the frame border
    // Tall as the width allows, but never taller than ~90% of the viewport
    canvasHeight = Math.max(420, Math.min(canvasHeight, Math.round(canvasWidth * 0.72), Math.round(window.innerHeight * 0.9)))
    const compact = canvasWidth < 560
    const margin = {"top": 30, "right": compact ? 16 : 30, "bottom": 40, "left": compact ? 84 : 100 }
    const innerHeight = canvasHeight - margin.top - margin.bottom
    const innerWidth = canvasWidth - margin.left - margin.right
    const dpr = window.devicePixelRatio || 1
    const PADDING = 10
    const RADIUS_NORMAL = 3 // for plotting circles
    const RADIUS_HOVER = 4
    const RADIUS_SELECT = 5

    const xScale = d3.scaleLinear()
        .domain([0, d3.max(osc_perGene_meta, d=> d.phase)])
        .range([0 + PADDING, innerWidth - PADDING])
        .nice()

    const total_y_extent = d3.extent(osc_perGene_meta.flatMap(d => [d.period_high95, d.period_low95]))
    const yScale = d3.scaleLinear()
        // .domain(d3.extent(osc_perGene_meta, d => d.period))
        .domain([Math.floor(total_y_extent[0]), Math.ceil(total_y_extent[1])])
        .range([0, innerHeight])
        .nice()

    const container_div = d3.select(div_name)
        .style('width', '100%')
        .style('height', (canvasHeight + 2) + 'px') // +2 = the frame's 1px borders (border-box)
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

    const confIntCanvas = container_div.append('canvas')
        .attr('width', innerWidth * dpr)
        .attr('height', innerHeight * dpr)
        .style('width', innerWidth + 'px')
        .style('height', innerHeight + 'px')
        .style('position', 'absolute')
        .style('top', margin.top + 'px')
        .style('left', margin.left + 'px')
        .style('pointer-events', 'none')

    const CanvasCtx = canvas.node().getContext('2d')
    CanvasCtx.scale(dpr, dpr)
    const HightlightCanvasCtx = highlightCanvas.node().getContext('2d')
    HightlightCanvasCtx.scale(dpr, dpr)
    const confIntCanvasCtx = confIntCanvas.node().getContext('2d')
    confIntCanvasCtx.scale(dpr, dpr)

    // Filter ranges from the three violin scrubbers (inclusive). null = no constraint yet.
    const filterRanges = {
        log_TPM: null,
        qval: null,
        relative_std: null,
    }
    let genes_passed_set = new Set(osc_perGene_meta.map((v) => v.GeneID))
    let current_hover = null
    let current_selection = new Set()
    let current_display_gene = null
    let hovering_just_interval = null
    let current_just_bands = null 
    let selected_just_interval = null
    let confidence_focus = false 
    let currentXScale = xScale
    let currentYScale = yScale

    function inRange(value, range) {
        if (!range) return true
        const [low, high] = range
        return value >= low && value <= high
    }

    function applyFilters() {
        const next = new Set()
        for (let i = 0; i < osc_perGene_meta.length; i++) {
            const d = osc_perGene_meta[i]
            if (
                inRange(d.log_TPM, filterRanges.log_TPM) &&
                inRange(d.qval, filterRanges.qval) &&
                inRange(d.relative_std, filterRanges.relative_std)
            ) {
                next.add(d.GeneID)
            }
        }
        genes_passed_set = next

        let pruned = false
        current_selection.forEach((item) => {
            if (!genes_passed_set.has(item.GeneID)) {
                current_selection.delete(item)
                pruned = true
            }
        })
        if (pruned) bus.execute_event("selection_modified", current_selection)

        rebuildQuadtree(currentXScale, currentYScale)
        drawPoints(CanvasCtx, currentXScale, currentYScale, RADIUS_NORMAL)
        drawHighlight(HightlightCanvasCtx, currentXScale, currentYScale)
    }

    function setFilterRange(key, high_val, low_val) {
        filterRanges[key] = [low_val, high_val]
        applyFilters()
    }

    function drawPoints(ctx, xSc, ySc, radius = RADIUS_NORMAL) {
        ctx.clearRect(0, 0, innerWidth, innerHeight)

        // Filter-failed genes (always faint grey)
        ctx.fillStyle = PT_INACTIVE
        ctx.beginPath()
        for (let i = 0; i < osc_perGene_meta.length; i++) {
            const d = osc_perGene_meta[i]
            if (genes_passed_set.has(d.GeneID)) continue
            const x = xSc(d.phase)
            const y = ySc(d.period)
            ctx.moveTo(x + radius, y)
            ctx.arc(x, y, radius, 0, 2 * Math.PI)
        }
        ctx.fill()

        if (!confidence_focus) {
            // No interval hovered — single batched fill for passed genes
            ctx.fillStyle = PT_ACTIVE
            ctx.beginPath()
            for (let i = 0; i < osc_perGene_meta.length; i++) {
                const d = osc_perGene_meta[i]
                if (!genes_passed_set.has(d.GeneID)) continue
                const x = xSc(d.phase)
                const y = ySc(d.period)
                ctx.moveTo(x + radius, y)
                ctx.arc(x, y, radius, 0, 2 * Math.PI)
            }
            ctx.fill()
            return
        }

        for (let i = 0; i < osc_perGene_meta.length; i++) {
            const d = osc_perGene_meta[i]
            if (!genes_passed_set.has(d.GeneID)) continue
            const o = d.conf_overlap || 0
            const alpha = o > 0 ? 0.25 + 0.75 * o : 0.07
            const x = xSc(d.phase)
            const y = ySc(d.period)

            if (o > 0) {
                ctx.strokeStyle = withAlpha(PALETTE.teal, alpha)
                ctx.lineWidth = 1
                ctx.beginPath()
                ctx.moveTo(x, ySc(d.period_low95))
                ctx.lineTo(x, ySc(d.period_high95))
                ctx.stroke()
            }

            ctx.fillStyle = o > 0 ? withAlpha(PALETTE.teal, alpha) : withAlpha(PALETTE.indigo, alpha)
            ctx.beginPath()
            ctx.moveTo(x + radius, y)
            ctx.arc(x, y, radius, 0, 2 * Math.PI)
            ctx.fill()
        }
    }

    drawPoints(CanvasCtx, xScale, yScale, RADIUS_NORMAL)

    // halo + dark ring so markers stay readable on dense clusters
    function marker(ctx, x, y, r, fill) {
        ctx.beginPath()
        ctx.arc(x, y, r + 1.5, 0, 2 * Math.PI)
        ctx.fillStyle = "rgba(255,255,255,0.9)"
        ctx.fill()
        ctx.beginPath()
        ctx.arc(x, y, r, 0, 2 * Math.PI)
        ctx.fillStyle = fill
        ctx.fill()
        ctx.lineWidth = 1.25
        ctx.strokeStyle = THEME.ink
        ctx.stroke()
    }

    function drawHighlight(HightlightCanvasCtx, xSc, ySc, hover_radius = RADIUS_HOVER, selected_radius = RADIUS_SELECT, show_all_phase = false) {
        HightlightCanvasCtx.clearRect(0, 0, innerWidth, innerHeight) //Clear canvas
        current_selection.forEach((val) => {
            marker(HightlightCanvasCtx, xSc(val.phase), ySc(val.period), selected_radius, PALETTE.rose)
        })
        if (current_display_gene){
            marker(HightlightCanvasCtx, xSc(current_display_gene.phase), ySc(current_display_gene.period), hover_radius * 1.6, PALETTE.sand)
        }
        // mouse down + drag show possible phases
        if (show_all_phase && drag_point) {
            const min_phase = drag_point.phase % drag_point.period
            let cur_phase = min_phase
            while (cur_phase < 24) {
                const isClosest = cur_phase === closest_point_to_drag
                marker(
                    HightlightCanvasCtx, xSc(cur_phase), ySc(drag_point.period),
                    isClosest ? selected_radius * 1.3 : selected_radius,
                    isClosest ? PALETTE.green : PALETTE.purple
                )
                cur_phase += drag_point.period
            }
        }
        //hover highlight
        if (current_hover){
            marker(HightlightCanvasCtx, xSc(current_hover.phase), ySc(current_hover.period), hover_radius, PALETTE.teal)
        }
    }

    const just_tuning = {
        "Unison (1:1)" : 1/1,
        "Octave (2:1)": 2/1,
        "Perfect Fifth (3:2)" : 3/2,
        "Perfect Fourth (4:3)" : 4/3,
        "Major Third (5:4)" : 5/4,
        "Minor Third (6:5)" : 6/5,
        "Major Sixth (5:3)" : 5/3,
    }

    function justIntervalBands(item) {
        const high = item.period_high95
        const low = item.period_low95
        const mid = item.period
        const bands = []
        for (const [name, ratio] of Object.entries(just_tuning)) {
            bands.push({
                id: name,
                label: name,
                low: low * ratio,
                high: high * ratio,
                mid: mid * ratio,
            })
            if (ratio !== 1) {
                bands.push({
                    id: name + "_inv",
                    label: name + "⁻¹",
                    low: low / ratio,
                    high: high / ratio,
                    mid: mid / ratio,
                })
            }
        }
        return bands
    }

    function drawConfInt(item, xSc = currentXScale, ySc = currentYScale){
        confIntCanvasCtx.clearRect(0, 0, innerWidth, innerHeight)
        if (!item || !current_just_bands) return

        const [xDomMin, xDomMax] = xSc.domain()
        const x0 = xSc(xDomMin)
        const bandWidth = xSc(xDomMax) - x0

        for (const band of current_just_bands) {
            const yA = ySc(band.low)
            const yB = ySc(band.high)
            const y = Math.max(0, Math.min(yA, yB))
            const yEnd = Math.min(innerHeight, Math.max(yA, yB))
            const h = yEnd - y
            if (h <= 0) continue

            const active = band.id === hovering_just_interval
            const locked = band.id === selected_just_interval
            if (locked){
                confIntCanvasCtx.fillStyle = withAlpha(PALETTE.sky, 0.55)
            } else if (active){
                confIntCanvasCtx.fillStyle = withAlpha(PALETTE.sky, 0.35)
            } else {
                confIntCanvasCtx.fillStyle = withAlpha(PALETTE.sky, 0.12)
            }
            confIntCanvasCtx.fillRect(x0, y, bandWidth, h)
            if (locked || active) {
                // crisp edges so the band extent reads clearly
                confIntCanvasCtx.strokeStyle = withAlpha(PALETTE.indigo, locked ? 0.9 : 0.5)
                confIntCanvasCtx.lineWidth = locked ? 1.5 : 1
                confIntCanvasCtx.beginPath()
                confIntCanvasCtx.moveTo(x0, y + 0.5); confIntCanvasCtx.lineTo(x0 + bandWidth, y + 0.5)
                confIntCanvasCtx.moveTo(x0, y + h - 0.5); confIntCanvasCtx.lineTo(x0 + bandWidth, y + h - 0.5)
                confIntCanvasCtx.stroke()
            }

            if (active) {
                confIntCanvasCtx.font = `600 ${compact ? 13 : 15}px Inter, system-ui, sans-serif`
                confIntCanvasCtx.lineJoin = "round"
                confIntCanvasCtx.textAlign = "right"
                confIntCanvasCtx.textBaseline = "middle"
                const labelY = Math.max(12, Math.min(innerHeight - 4, ySc(band.mid)))
                confIntCanvasCtx.lineWidth = 4
                confIntCanvasCtx.strokeStyle = "rgba(255,255,255,0.9)"
                confIntCanvasCtx.strokeText(band.label, x0 + bandWidth - 6, labelY)
                confIntCanvasCtx.fillStyle = THEME.ink
                confIntCanvasCtx.fillText(band.label, x0 + bandWidth - 6, labelY)
            }
        }
    }

    function intervalOverlap(aLow, aHigh, bLow, bHigh) {
        const inter = Math.max(0, Math.min(aHigh, bHigh) - Math.max(aLow, bLow))
        if (inter === 0) return 0
        const den = Math.min(aHigh - aLow, bHigh - bLow)
        return den > 0 ? inter / den : 0
    }

    function clearPointConfidence() {
        confidence_focus = false
        for (let i = 0; i < osc_perGene_meta.length; i++) {
            osc_perGene_meta[i].conf_overlap = undefined
        }
        drawPoints(CanvasCtx, currentXScale, currentYScale)
    }

    function updatePointConfidence(interval_id) {
        if (!current_display_gene || !interval_id || !current_just_bands) {
            clearPointConfidence()
            return
        }
        const band = current_just_bands.find((b) => b.id === interval_id)
        if (!band) {
            clearPointConfidence()
            return
        }

        confidence_focus = true
        for (let i = 0; i < osc_perGene_meta.length; i++) {
            const d = osc_perGene_meta[i]
            d.conf_overlap = intervalOverlap(
                d.period_low95, d.period_high95,
                band.low, band.high
            )
        }
        drawPoints(CanvasCtx, currentXScale, currentYScale)
    }

    // ------------ draw piano ------------
    const pitchNames = [
        "A3", "A♯3/B♭3", "B3", 
        "C4", "C♯4/D♭4", "D4", "D♯4/E♭4", "E4", "F4", "F♯4/G♭4", "G4", "G♯4/A♭4", "A4", "A♯4/B♭4", "B4", 
        "C5", "C♯5/D♭5", "D5", "D♯5/E♭5", "E5", "F5", "F♯5/G♭5", "G5", "G♯5/A♭5", "A5", "A♯5/B♭5", "B5",
        "C6", "C♯6/D♭6", "D6", "D♯6/E♭6", "E6", "F6", "F♯6/G♭6", "G6", "G♯6/A♭6", "A6"
    ]
    
    const pitchTable = Array.from(pitchNames, (val, idx) => {
        const pitchCenter = 220 * Math.pow(Math.pow(2, 1 / 12), idx)
        return {
            pitchName: val,
            pitchCenter,
            keyColor: val.includes("/") ? "black" : "white",
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

    const WHITE_KEY_LENGTH = compact ? 24 : 30
    const BLACK_KEY_LENGTH = compact ? 15 : 20
    const PITCH_SCALE = 10560 // 24hrs * 440 Hz
    const whiteKeys = pitchTable.filter((d) => d.keyColor === "white")
    const blackKeys = pitchTable.filter((d) => d.keyColor === "black")
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

    function drawPiano(ySc){
        leftAxisandKeys.selectAll('.white-key')
            .data(whiteKeys, (d) => d.pitchName)
            .join('rect')
            .attr('class', 'white-key')
            .attr("x", 0)
            .attr("y", (d) => ySc(PITCH_SCALE / d.topEdge))
            .attr("width", WHITE_KEY_LENGTH)
            .attr("height", (d) => ySc(PITCH_SCALE / d.botEdge) - ySc(PITCH_SCALE / d.topEdge))
            .attr("fill", "white")
            .attr("stroke", THEME.axis)
            .attr("stroke-width", "1")

        leftAxisandKeys.selectAll('.black-key')
            .data(blackKeys, (d) => d.pitchName)
            .join('rect')
            .attr('class', 'black-key')
            .attr("x", 0)
            .attr("y", (d) => ySc(PITCH_SCALE / d.topEdge))
            .attr("width", BLACK_KEY_LENGTH)
            .attr("height", (d) => ySc(PITCH_SCALE / d.botEdge) - ySc(PITCH_SCALE / d.topEdge))
            .attr("fill", THEME.ink)
            .attr("stroke", THEME.ink)
            .attr("stroke-width", "1")
            .attr("rx", 2)

        leftAxisandKeys.selectAll('.white-key-label')
            .data(whiteKeys, (d) => d.pitchName)
            .join('text')
            .attr('class', 'white-key-label')
            .attr('x', WHITE_KEY_LENGTH * 0.9)
            .attr('y', (d) => {
                const top = ySc(PITCH_SCALE / d.topEdge)
                const bot = ySc(PITCH_SCALE / d.botEdge)
                return top + (bot - top) * 0.5
            })
            .attr('text-anchor', 'end')
            .attr('dominant-baseline', 'middle')
            .attr('font-size', (d) => {
                const keyHeight = ySc(PITCH_SCALE / d.botEdge) - ySc(PITCH_SCALE / d.topEdge)
                return Math.min(keyHeight * 0.3, 20) + 'px'
            })
            .attr('fill', THEME.muted)
            .attr('pointer-events', 'none')
            .text((d) => d.pitchName)
    }

    drawPiano(yScale)
    // ------------ Scrubber --------------
    const SCRUBBER_HANDLE_WIDTH = 5
    const SCRUBBER_HANDLE_HEIGHT = 10
    const scrubber = plotArea.append('g')
    const scrubber_needle = scrubber.append('line')
        .attr("x1", xScale(0))
        .attr("y1", 0 - SCRUBBER_HANDLE_HEIGHT)
        .attr("x2", xScale(0))
        .attr("y2", innerHeight)
        .attr("stroke", PALETTE.wine)
        .attr("stroke-width", "2")
        .attr("stroke-linecap", "round")
    const scrubber_handle = scrubber.append('rect')
        .attr("x", xScale(0) - SCRUBBER_HANDLE_WIDTH/2)
        .attr("y", 0 - SCRUBBER_HANDLE_HEIGHT)
        .attr("width", SCRUBBER_HANDLE_WIDTH)
        .attr("height", SCRUBBER_HANDLE_HEIGHT)
        .attr("fill", PALETTE.wine)
        .attr("stroke", PALETTE.wine)
        .attr("stroke-width", "1")
        .attr("rx", 2)
    
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
    drawAxis(xAxis, d3.axisBottom(xScale).tickSizeOuter(0))
    
    const yAxisLabel = svg.append('g')
        .attr('transform', `translate(${margin.left - WHITE_KEY_LENGTH}, ${margin.top})`)

    const yAxis = yAxisLabel.append("g") //use svg so it can be further left of plotArea
        .attr("transform", `translate(0, 0)`)
    drawAxis(yAxis, d3.axisLeft(yScale).tickSizeOuter(0))

    axisLabel(plotArea.append("text")
        .attr("x", innerWidth / 2)
        .attr("y", innerHeight + 32))
        .text("Hours")

    axisLabel(yAxisLabel.append("text")
        .attr("transform", "rotate(-90)")
        .attr("x", - innerHeight/2)
        .attr("y", -34))
        .text("Period")

    plotArea.append("text")
        .attr("x", innerWidth / 2)
        .attr("y", -5)
        .attr("text-anchor", "middle")
        .attr("font-size", "15px")

    // Hover & selection control
    let quadtree = null

    // Prefer selected points; ignore greyed-out (filtered) genes for new picks
    function findClosest(mx, my) {
        let closest_selected = null
        let closest_selected_dist2 = Infinity
        const selectR2 = RADIUS_SELECT * RADIUS_SELECT

        current_selection.forEach((d) => {
            const dx = currentXScale(d.phase) - mx
            const dy = currentYScale(d.period) - my
            const dist2 = dx * dx + dy * dy
            if (dist2 <= selectR2 && dist2 < closest_selected_dist2) {
                closest_selected = d
                closest_selected_dist2 = dist2
            }
        })

        if (closest_selected) return closest_selected

        return quadtree.find(mx, my, RADIUS_HOVER)
    }

    function addPoints(item) {
        if (!item) return
        if (current_selection.has(item)) {
            return
        } else if (genes_passed_set.has(item.GeneID)) {
            bus.execute_event("selection_add", item)
        }
    }

    function removePoints(item) {
        if (!item) return
        bus.execute_event("selection_del", item)
    }


    function rebuildQuadtree(xSc, ySc) {
        // Selectable genes are filtered here
        const passed = []
        for (let i = 0; i < osc_perGene_meta.length; i++) {
            const d = osc_perGene_meta[i]
            if (!genes_passed_set.has(d.GeneID)) continue
            if (selected_just_interval && !(d.conf_overlap > 0)) continue
            passed.push(d)
        }
        quadtree = d3.quadtree()
            .x((d) => xSc(d.phase))
            .y((d) => ySc(d.period))
            .addAll(passed)
    }

    rebuildQuadtree(xScale, yScale)

    // Zoom control
    let rafId = null
    function applyZoomView(zx, zy, { rebuild = false } = {}) {
        currentXScale = zx
        currentYScale = zy
        drawPoints(CanvasCtx, zx, zy, RADIUS_NORMAL)
        drawHighlight(HightlightCanvasCtx, zx, zy, RADIUS_HOVER, RADIUS_SELECT)
        drawConfInt(current_display_gene, zx, zy)
        drawPiano(zy)
        drawAxis(xAxis, d3.axisBottom(zx).tickSizeOuter(0))
        drawAxis(yAxis, d3.axisLeft(zy).tickSizeOuter(0))
        if (rebuild) rebuildQuadtree(zx, zy)
    }
    const zoom = d3.zoom()
        .scaleExtent([1, 20])
        .extent([[0, 0], [innerWidth, innerHeight]])
        .on("zoom", (event) => {
            const zx = event.transform.rescaleX(xScale)
            const zy = event.transform.rescaleY(yScale)
            if (rafId) cancelAnimationFrame(rafId)
            rafId = requestAnimationFrame(() => {
                rafId = null
                applyZoomView(zx, zy)
            })
        })
        .on("end", (event) => {
            const zx = event.transform.rescaleX(xScale)
            const zy = event.transform.rescaleY(yScale)
            applyZoomView(zx, zy, { rebuild: true })
        })
    
    zoom.filter((event) => {
        const startsPanning = event.type === "mousedown"
        if (startsPanning && current_hover) return false

        return (!event.ctrlKey || event.type === "wheel") && !event.button
    })
    canvas.call(zoom)
    canvas.on('dblclick.zoom', null)

    // Phase controls and displays + point select behavior
    let drag_point = null
    let mousedown = false
    let dragging = false
    let closest_point_to_drag = null
    let clicked_point = null
    let pointerDownPos = null
    const DRAG_THRESHOLD_PX = 4

    function snapPhase(pointerX){
        const min_phase = drag_point.phase % drag_point.period
        const pointer_pos = currentXScale.invert(pointerX)
        let closest_phase = Infinity
        let closest_point = null
        for (let i = min_phase; i <= 24; i += drag_point.period) {
            const dist = Math.abs(pointer_pos - i)
            if (dist < closest_phase) {
                closest_phase = dist
                closest_point = i
            }
        }
        return closest_point
    }

    canvas.on('pointerdown', (event) => {
        const [mx, my] = d3.pointer(event)
        clicked_point = findClosest(mx, my)
        pointerDownPos = [mx, my]
        mousedown = true
    })

    canvas.on('pointermove', (event) => {
        const [mx, my] = d3.pointer(event)

        if (mousedown && !dragging && pointerDownPos) {
            const dx = mx - pointerDownPos[0]
            const dy = my - pointerDownPos[1]
            if (dx * dx + dy * dy > DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
                dragging = true
                drag_point = clicked_point
            }
        }

        if (!drag_point) { // hover behavior
            const item = findClosest(mx, my)

            if (current_display_gene && current_just_bands) {
                const my_period = currentYScale.invert(my)
                let nextHover = null
                let bestDist = Infinity
                for (const band of current_just_bands) {
                    if (my_period <= band.high && my_period >= band.low) {
                        const dist = Math.abs(my_period - band.mid)
                        if (dist < bestDist) {
                            bestDist = dist
                            nextHover = band.id
                        }
                    }
                }
                if (nextHover !== hovering_just_interval) {
                    hovering_just_interval = nextHover
                    if (!selected_just_interval) {
                        updatePointConfidence(hovering_just_interval)
                    }
                    drawConfInt(current_display_gene)
                }
            }
            if (item !== current_hover) {
                current_hover = item
                bus.execute_event("point_hover", current_hover ? current_hover.GeneID : null)
            }
        } else { // phase dragging
            closest_point_to_drag = snapPhase(mx)
            drawHighlight(HightlightCanvasCtx, currentXScale, currentYScale, RADIUS_HOVER, RADIUS_SELECT, true)
        }
    })

    let lastPointerUp = { x: null, y: null, time: null }
    let singleClickTimer = null
    const doubleClickDelay = 300 // ms
    const doubleClickDist = 10 // px

    function clearJustIntervalSelection() {
        selected_just_interval = null
        if (hovering_just_interval) {
            updatePointConfidence(hovering_just_interval)
        } else {
            clearPointConfidence()
        }
        rebuildQuadtree(currentXScale, currentYScale)
        drawConfInt(current_display_gene)
    }

    function handleSingleClick(point, hoverInterval) {
        if (point) {
            addPoints(point)
            if (!selected_just_interval) {
                bus.execute_event("gene_label_select", point)
            }
            return
        }

        if (hoverInterval) {
            if (selected_just_interval === hoverInterval) return
            selected_just_interval = hoverInterval
            updatePointConfidence(hoverInterval)
            rebuildQuadtree(currentXScale, currentYScale)
            drawConfInt(current_display_gene)
            return
        }

        // Click away: clear CI lock, or clear the displayed gene
        if (selected_just_interval) {
            clearJustIntervalSelection()
        } else {
            bus.execute_event("gene_label_select", null)
        }
    }

    function handleDoubleClick(point) {
        // Deselect a selected gene on double-click; otherwise zoom out only
        if (point && current_selection.has(point)) {
            const sizeBefore = current_selection.size
            removePoints(point)
            if (current_selection.size < sizeBefore) {
                bus.execute_event("gene_label_select", null)
                drawHighlight(HightlightCanvasCtx, currentXScale, currentYScale)
                return
            }
        }
        // Zoom out takes prio over CI select / display gene / point selection
        canvas.transition().duration(500).call(zoom.transform, d3.zoomIdentity)
    }

    canvas.on('pointerup', (event) => {
        const didDragPhase = drag_point && closest_point_to_drag != null && drag_point.phase !== closest_point_to_drag
        if (didDragPhase) {
            drag_point.phase = closest_point_to_drag
            rebuildQuadtree(currentXScale, currentYScale)
            drawPoints(CanvasCtx, currentXScale, currentYScale, RADIUS_NORMAL)
            drawHighlight(HightlightCanvasCtx, currentXScale, currentYScale)
        }

        const pointerWasDrag = dragging
        const point = clicked_point
        const hoverInterval = hovering_just_interval

        const shortDistance = lastPointerUp.x != null
            && Math.hypot(event.clientX - lastPointerUp.x, event.clientY - lastPointerUp.y) <= doubleClickDist
        const shortTime = lastPointerUp.time != null
            && Date.now() - lastPointerUp.time <= doubleClickDelay
        const isDoubleClick = shortTime && shortDistance
        lastPointerUp = { x: event.clientX, y: event.clientY, time: Date.now() }

        drag_point = null
        dragging = false
        mousedown = false
        clicked_point = null
        closest_point_to_drag = null
        pointerDownPos = null

        if (pointerWasDrag || didDragPhase) {
            if (singleClickTimer) {
                clearTimeout(singleClickTimer)
                singleClickTimer = null
            }
            return
        }

        if (isDoubleClick) {
            if (singleClickTimer) {
                clearTimeout(singleClickTimer)
                singleClickTimer = null
            }
            handleDoubleClick(point)
            return
        }

        if (point) {
            if (singleClickTimer) {
                clearTimeout(singleClickTimer)
                singleClickTimer = null
            }
            handleSingleClick(point, hoverInterval)
            return
        }

        if (singleClickTimer) clearTimeout(singleClickTimer)
        singleClickTimer = setTimeout(() => {
            singleClickTimer = null
            handleSingleClick(null, hoverInterval)
        }, doubleClickDelay)
    })

    function updateCurrentDisplayGene(item) {
        current_display_gene = item || null
        hovering_just_interval = null
        selected_just_interval = null
        current_just_bands = item ? justIntervalBands(item) : null
        clearPointConfidence()
        rebuildQuadtree(currentXScale, currentYScale)
        drawConfInt(current_display_gene)
        drawHighlight(HightlightCanvasCtx, currentXScale, currentYScale)
    }

    //bus subscription
    bus.subscribe_to("point_hover", "mainplot", () => {
        drawHighlight(HightlightCanvasCtx, currentXScale, currentYScale)
    })
    bus.subscribe_to("selection_add", "mainplot", (item) => {
        current_selection.add(item)
        bus.execute_event("selection_modified", current_selection)
    })
    bus.subscribe_to("selection_del", "mainplot", (item) => {
        current_selection.delete(item)
        bus.execute_event("selection_modified", current_selection)
        if (current_display_gene && item && current_display_gene.GeneID === item.GeneID) {
            updateCurrentDisplayGene(null)
        }
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
        updateCurrentDisplayGene(null)
        bus.execute_event("selection_modified", current_selection)
    })
    bus.subscribe_to("StepSeqTPMUpdate", "mainplot", ([high_val, low_val]) => {
        setFilterRange("log_TPM", high_val, low_val)
    })
    bus.subscribe_to("StepSeqqValUpdate", "mainplot", ([high_val, low_val]) => {
        setFilterRange("qval", high_val, low_val)
    })
    bus.subscribe_to("StepSeqStdUpdate", "mainplot", ([high_val, low_val]) => {
        setFilterRange("relative_std", high_val, low_val)
    })
    bus.subscribe_to("gene_label_select", "mainplot", (item) => {
        updateCurrentDisplayGene(item)
        drawHighlight(HightlightCanvasCtx, currentXScale, currentYScale)
    })
}

export function plotStepSeqWave(width, height, div_name = "#SeqRightPlot"){
    const host = document.querySelector(div_name)
    if (host?.clientWidth) {
        width = Math.max(240, Math.floor(host.clientWidth))
        height = Math.max(220, Math.min(height, Math.round(width * 0.72)))
    }
    const margin = {top: 44, right: 20, bot: 46, left: 54}
    const innerWidth = width - margin.left - margin.right
    const innerHeight = height - margin.top - margin.bot

    const div = d3.select(div_name)
        .style("height", null) // let the svg define the height (avoids 1-2px scrollbars from borders)
        .style("position", "relative")

    div.selectAll('svg').remove()

    const svg = div.append('svg')
        .attr("width", width)
        .attr("height", height)
        .style("position", "relative")
        .style("display", "block")
    
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
    
    axisLabel(plotArea.append("text")
        .attr("x", innerWidth / 2)
        .attr("y", innerHeight + 36))
        .text("Hours")
    
    axisLabel(plotArea.append("text")
        .attr("transform", "rotate(-90)")
        .attr("x", -innerHeight/2)
        .attr("y", -38))
        .text("VST expression")
    
    const titleText = plotTitle(plotArea.append("text")
        .attr("transform", `translate(0,-18)`))
        .style("font-family", THEME.fontMono)

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
            .attr("fill", PALETTE.indigo)
            .attr("opacity", 0.12)
            .attr("stroke", "none")
            .attr("d", (d) => area(d))

        const line_sample_wavs = d3.line()
            .x((_, i) => xScale((i * period) / metaValues.N_GRID))
            .y((d) => yScale(d * scale + center))

        samplesGroup.selectAll("path")
            .data(sample_wavs)
            .join("path")
            .attr("fill", "none")
            .attr("stroke", PALETTE.teal)
            .attr("stroke-width", 1.75)
            .attr("opacity", 0.55)
            .attr("d", (dat) => line_sample_wavs(dat))

        const line_mu_wav = d3.line()
            .x((_, i) => xScale((i * period) / metaValues.N_GRID))
            .y((d) => yScale(d))

        muGroup.selectAll("path")
            .data([mu])
            .join("path")
            .attr("fill", "none")
            .attr("stroke", PALETTE.indigo)
            .attr("stroke-width", 2.5)
            .attr("opacity", 0.95)
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
            .attr("r", 4.5)
            .attr("fill", PALETTE.rose)
            .attr("stroke", "#fff")
            .attr("stroke-width", 1.5)
            .attr("cx", (d) => xScale(d.x))
            .attr("cy", (d) => yScale(d.y))
    }

    renderEmpty()

    return {renderEmpty, updatePlot}
}
