const bus = {
    _listeners: {},
    subscribe_to(event, id, fn){
        if (!this._listeners[event]) this._listeners[event] = {}
        this._listeners[event][id] = fn
    },
    execute_event(event, data) {
        Object.values(this._listeners[event] || {}).forEach(fn => fn(data))
    }
}

async function load_waveforms(path_to_bin, path_to_meta){
    const resp_meta = await fetch(path_to_meta)
    const meta_json = await resp_meta.json()
    
    const bin = await fetch(path_to_bin)
    const buff = await bin.arrayBuffer()
    const flat_arr = new Float32Array(buff)

    const BYTE_OFFSET = meta_json.BYTE_OFFSET
    const N_GRID = meta_json.N_GRID
    const N_SAMPLES = meta_json.N_SAMPLES
    const N_WAVES = meta_json.N_WAVES
    const WAVE_KEYS = meta_json.WAVE_KEYS
    
    const arr = Array.from({length: meta_json.meta.length}, (_, r) => {
        const row = {}
        for (let i=0; i<N_WAVES; i++){
            row[WAVE_KEYS[i]] = flat_arr.slice(256 * i, 256 * i + 256)
        }
        return row
    })

    return [arr, meta_json]
}

const [wav, meta] = await load_waveforms("/home/yeti1t3y/Documents/ArabidopsisPiano/dat/waveforms.bin", "/home/yeti1t3y/Documents/ArabidopsisPiano/dat/waveforms_meta.json")
const period_phase_fap = meta.meta
const period_phase_fap_lookup = new Map(period_phase_fap.map(r => [r.GeneID, r]))
const wav_lookup = new Map(period_phase_fap.map((row,idx) => [row.GeneID, wav[idx]]))


// --------- Plot period vs phase ---------
function plotMain(canvasWidth = 600, canvasHeight = 400, div_name = "#StepSequencer", period_phase_fap, bus){
    const margin = {"top": 30, "right": 30, "bottom": 40,"left": 50, }
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
        .domain(d3.extent(period_phase_fap, d => d.period))
        .range([innerHeight, 0])
        .nice()

    const container_div = d3.select(div_name)
        .style('width', canvasWidth + 'px')
        .style('height', canvasHeight + 'px')
        .style('position', 'relative')

    const svg = container_div.append('svg')
        .attr('width', canvasWidth)
        .attr('height', canvasHeight)
        .style('positon', 'absolute')
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
        for (let i=0; i<period_phase_fap.length; i++){
            const d = period_phase_fap[i]
            CanvasCtx.moveTo(xSc(d.phase) + radius, ySc(d.period))
            CanvasCtx.arc(xSc(d.phase), ySc(d.period), radius, 0, 2*Math.PI)
        }
        CanvasCtx.fill()
    }
    drawPoints(CanvasCtx, xScale, yScale, RADIUS_NORMAL)

    function drawHighlight(HightlightCanvasCtx, xSc, ySc, hover_radius = RADIUS_HOVER, selected_radius = RADIUS_SELECT) {
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
        //hover highlight
        if (current_hover){
            HightlightCanvasCtx.fillStyle = "orange"
            HightlightCanvasCtx.beginPath()
            HightlightCanvasCtx.moveTo(xSc(current_hover.phase) + hover_radius, ySc(current_hover.period))
            HightlightCanvasCtx.arc(xSc(current_hover.phase), ySc(current_hover.period), hover_radius, 0, 2*Math.PI)
            HightlightCanvasCtx.fill()
        } else {return}
    }

    // Set up Axis and labels
    const xAxis = plotArea.append('g')
        .attr('transform', `translate(0, ${innerHeight})`)
        .call(d3.axisBottom(xScale))
        
    const yAxis = plotArea.append("g")
        .attr("transform", `translate(0, 0)`)
        .call(d3.axisLeft(yScale))
    
    plotArea.append("text")
        .attr("x", innerWidth / 2)
        .attr("y", innerHeight + 30)
        .attr("text-anchor", "middle")
        .attr("font-size", "12px")
        .text("Hours")

    plotArea.append("text")
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
    let current_selection_id = new Array()

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
                current_selection.delete(item)
                current_selection_id = Array.from(current_selection, d => d.GeneID)
                bus.execute_event("selection_modified", current_selection_id)
            } else {
                current_selection.add(item)
                current_selection_id = Array.from(current_selection, d => d.GeneID)
                bus.execute_event("selection_modified", current_selection_id)
            }
        }
    }


    function rebuildQuadtree(xSc, ySc) {
        quadtree = d3.quadtree()
            .x(d => xSc(d.phase))
            .y(d => ySc(d.period))
            .addAll(period_phase_fap)
    }

    rebuildQuadtree(xScale, yScale)
    canvas.on('mousemove', (event) =>{
        const [mx, my] = d3.pointer(event)
        const item = findClosest(mx, my)
        if (item !== current_hover){
            console.log(current_selection.has(item))
            current_hover = item
            if (current_hover == null){
                bus.execute_event("point_hover", null)
            } else {
                bus.execute_event("point_hover", current_hover.GeneID)
            }
        } else {return}
    })

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
            xAxis.call(d3.axisBottom(zx))
            yAxis.call(d3.axisLeft(zy))
            currentXScale = zx
            currentYScale = zy
            rebuildQuadtree(zx, zy)
        })

    canvas.call(zoom)
    canvas.on('dblclick.zoom', null)
    canvas.on('dblclick', () => {
        canvas.transition().duration(500).call(zoom.transform, d3.zoomIdentity)
    })
    canvas.on('click', (event) =>{
        const [mx, my] = d3.pointer(event)
        const item = findClosest(mx, my)
        updatePoints(item)
    })

    //bus subscription
    bus.subscribe_to("point_hover", "mainplot", (current_hover) => {
        drawHighlight(HightlightCanvasCtx, currentXScale, currentYScale)
    })
    bus.subscribe_to("selection_modified", "mainplot", (current_selection_id) => {
        drawHighlight(HightlightCanvasCtx, currentXScale, currentYScale)
    })
}

// --------- handle sound waves -----------

// sound wave merging

function mergeWav(GeneID, wav_lookup, period_phase_fap_lookup){
    const cur_ppf = period_phase_fap_lookup.get(GeneID)
    const cur_wav = wav_lookup.get(GeneID)
    const fap = cur_ppf.fap
    
}


plotMain(600, 400, "#StepSequencer", period_phase_fap, bus)
// const [a, b] = mergeWav("AT1G14980", wav_lookup, period_phase_fap_lookup)
// console.log(a, b)