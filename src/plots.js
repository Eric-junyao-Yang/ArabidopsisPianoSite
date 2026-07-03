async function meta_to_json(path_to_meta, file_name){
    const resp_meta = await fetch(path_to_meta)
    const meta_json = await resp_meta.json()
    const meta_json_dat = meta_json[file_name]
    return meta_json_dat
}

async function bin_to_array(path_to_bin, path_to_meta){
    const file_name = path_to_bin.split("/").pop()
    const meta_json_dat = await meta_to_json(path_to_meta, file_name)

    const resp_bin = await fetch(path_to_bin)
    const buff = await resp_bin.arrayBuffer()
    const flat_arr = new Float32Array(buff)

    const n = meta_json_dat.n
    const d = meta_json_dat.d
    const colnames = meta_json_dat.colnames

    const arr = Array.from({length: meta_json_dat.n}, (_, i) => {
        const row = {}
        for (let k=0; k<d; k++){
            row[colnames[k]] = flat_arr[i * d + k]
        }
        return row
    })

    return arr
}

function split_xy(arr){
    const len = arr.length
    const x = new Array(len)
    const y = new Array(len)
    for (let i=0; i<arr.length; i++){
        x[i] = arr[i].x
        y[i] = arr[i].y
    }
    return [x, y]
}

let count_umap_arr = await bin_to_array(
    "/run/media/yeti1t3y/Extreme SSD/My_Codes/ArabidopsisPiano/Processed_Data/count_umap.bin", 
    "/run/media/yeti1t3y/Extreme SSD/My_Codes/ArabidopsisPiano/Processed_Data/bin_meta.json"
)

let fft_umap_arr = await bin_to_array(
    "/run/media/yeti1t3y/Extreme SSD/My_Codes/ArabidopsisPiano/Processed_Data/fft_umap.bin", 
    "/run/media/yeti1t3y/Extreme SSD/My_Codes/ArabidopsisPiano/Processed_Data/bin_meta.json"
)

// const min_max_arr = await bin_to_array(
//     "/run/media/yeti1t3y/Extreme SSD/My_Codes/ArabidopsisPiano/Processed_Data/min_max_norm.bin", 
//     "/run/media/yeti1t3y/Extreme SSD/My_Codes/ArabidopsisPiano/Processed_Data/bin_meta.json"
// )

const min_max_meta = await meta_to_json(
    "/run/media/yeti1t3y/Extreme SSD/My_Codes/ArabidopsisPiano/Processed_Data/bin_meta.json",
    "min_max_norm.bin"
)

const ids = min_max_meta.rownames

function append_id_to_array(input_array, list_of_id){
    const out_arr = input_array.map((val, idx) => (
        {...val, id: list_of_id[idx]}
    ))
    return out_arr
}

// Add the GeneID (id) field
count_umap_arr = append_id_to_array(count_umap_arr, ids)
fft_umap_arr = append_id_to_array(fft_umap_arr, ids)


// add a bus for communication between plots
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

function indexToColor(i) {
    const r = ( i >> 16 ) & 0xff
    const g = ( i >> 8  ) & 0xff
    const b = ( i )       & 0xff
    return `rgb(${r}, ${g}, ${b})`
}

function colorToIndex(r,g,b) {
    return (r << 16) | (g << 8) | b
}

function plotUMAP(width, height, umap_arr, div_name, plot_title, displayGeneID = false, bus){

    const margin = { top: 20, right: 20, bottom: 40, left: 50 }
    const innerWidth = width - margin.left - margin.right
    const innerHeight = height - margin.top - margin.bottom

    const xScale = d3.scaleLinear()
    .domain(d3.extent(umap_arr, d => d.x))
    .range([0, innerWidth])
    .nice()

    const yScale = d3.scaleLinear()
    .domain(d3.extent(umap_arr, d => d.y))
    .range([innerHeight, 0])
    .nice()

    //Allow zooming
    let currentXScale = xScale
    let currentYScale = yScale

    //Set up svg (axis + titles etc) & mainCanvas (points)

    const svg = d3.select('#' + div_name)
        .append("svg")
        .attr('width', width)
        .attr('height', height)
        .style('position', 'absolute')
        .style('top', '0')
        .style('left', '0')
        .style('pointer-events', 'none')
        .style('outline', '2px solid red')

    const plotArea = svg.append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`)

    const mainCanvas = d3.select("#" + div_name)
        .append('canvas')
        .attr('width', innerWidth)
        .attr('height', innerHeight)
        .style('position', 'absolute')
        .style('top', margin.top + 'px')
        .style('left', margin.left + 'px')
        .style('outline', '2px solid orange')
    
    const highlightCanvas = d3.select("#" + div_name)
        .append('canvas')
        .attr('width', innerWidth)
        .attr('height', innerHeight)
        .style('position', 'absolute')
        .style('top', margin.top + 'px')
        .style('left', margin.left + 'px')
        .style('outline', '2px solid blue')
        .style('pointer-events', 'none')
    
    let quadtree = null
    function rebuildQuadtree(xSc, ySc) {
        quadtree = d3.quadtree()
            .x(d => xSc(d.x))
            .y(d => ySc(d.y))
            .addAll(umap_arr)
    }

    const mainCtx = mainCanvas.node().getContext('2d', { willReadFrequently: true })
    const hlightCtx = highlightCanvas.node().getContext('2d')

    const notHighlightPointSize = 2
    const HighlightPointSize = 6

    function drawPoints(xSc, ySc) {
        //Clear canvas
        mainCtx.clearRect(0,0,innerWidth, innerHeight)

        umap_arr.forEach((d,i) => {
            const cx = xSc(d.x)
            const cy = ySc(d.y)

            if (cx < 0 || cx > innerWidth || cy < 0 || cy > innerHeight) return

            mainCtx.beginPath()
            mainCtx.arc(cx, cy, notHighlightPointSize, 0, 2 * Math.PI)
            mainCtx.fillStyle = 'steelblue'
            mainCtx.fill()
        })
    }

    // Build a quick look up from GeneID -> Index
    const GeneID_Lookup = new Map(umap_arr.map(r => [r.id, r]))

    function drawHighlight(xSc, ySc, GeneID) {
        hlightCtx.clearRect(0,0,innerWidth, innerHeight)
        const d = GeneID_Lookup.get(GeneID)
        const cx = xSc(d.x)
        const cy = ySc(d.y)

        hlightCtx.beginPath()
        hlightCtx.arc(cx, cy, HighlightPointSize, 0, 2 * Math.PI)
        hlightCtx.fillStyle = 'red'
        hlightCtx.fill()
    }

    drawPoints(xScale, yScale)
    rebuildQuadtree(xScale, yScale)

    const xAxis = plotArea.append('g')
        .attr('transform', `translate(0, ${innerHeight})`)
        .call(d3.axisBottom(xScale))

    const yAxis = plotArea.append("g")
        .attr("transform", `translate(0, 0)`) // y-axis positioned at x=0 in data space ${xScale(0)}
        .call(d3.axisLeft(yScale))
    
    plotArea.append("text")
        .attr("x", innerWidth / 2)
        .attr("y", innerHeight + 30)
        .attr("text-anchor", "middle")
        .attr("font-size", "12px")
        .text("dim1")

    plotArea.append("text")
        .attr("transform", "rotate(-90)")
        .attr("x", - innerHeight/2)
        .attr("y", -30)
        .attr("text-anchor", "middle")
        .attr("font-size", "12px")
        .text("dim2")

    plotArea.append("text")
        .attr("x", innerWidth / 2)
        .attr("y", -5)
        .attr("text-anchor", "middle")
        .attr("font-size", "15px")
        .text(plot_title)
    
    const hoverLabel = plotArea.append("text")
        .attr("id", `hover-label-${div_name}`)
        .attr("x", 10)
        .attr("y", 20)
        .attr("text-anchor", "left")
        .attr("font-size", "12px")

    // Custom mouse over behavior

    let lastEmittedRow = null //To avoid repeated signal

    mainCanvas.on('mousemove', (event) => {
        const [mx, my] = d3.pointer(event)
        const d = quadtree.find(mx, my, 4)

        if (!d) {
            if (lastEmittedRow !== null) {
                lastEmittedRow = null
                bus.execute_event('point_hover', null)
            }
            return
        }

        if (lastEmittedRow){
            if (d.id !== lastEmittedRow.id){
                lastEmittedRow = d
                bus.execute_event('point_hover', d.id)
            }
        } else {
            lastEmittedRow = d
            bus.execute_event('point_hover', d.id) 
        }


    })

    mainCanvas.on('mouseleave', () => {
        if (lastEmittedRow !== null) {
            lastEmittedRow = null
            bus.execute_event('point_hover', null)
        }
    })

    let rafId = null
    const zoom = d3.zoom()
        .scaleExtent([1, 20])
        .extent([[0, 0], [innerWidth, innerHeight]])
        .on("zoom", (event) => {
            const zx = event.transform.rescaleX(xScale)
            const zy = event.transform.rescaleY(yScale)
            currentXScale = zx
            currentYScale = zy

            if (rafId) cancelAnimationFrame(rafId)
            rafId = requestAnimationFrame(() => {
                drawPoints(zx, zy)
                // drawHighlight(zx, zy)
                rebuildQuadtree(zx, zy)
                xAxis.call(d3.axisBottom(zx))
                yAxis.call(d3.axisLeft(zy))
            })
        })
        .on("end", (event) => {
            const zx = event.transform.rescaleX(xScale)
            const zy = event.transform.rescaleY(yScale)
            currentXScale = zx
            currentYScale = zy
            drawPoints(zx, zy)
            // drawHighlight(zx, zy)
            rebuildQuadtree(zx, zy)   
            xAxis.call(d3.axisBottom(zx))
            yAxis.call(d3.axisLeft(zy))
        })

    mainCanvas.call(zoom)
    mainCanvas.on('dblclick.zoom', null)
    mainCanvas.on('dblclick', () => {
        mainCanvas.transition().duration(500).call(zoom.transform, d3.zoomIdentity)
    })

    //subscribe to bus events
    bus.subscribe_to("point_hover", div_name, (GeneID) => {
        drawHighlight(currentXScale, currentYScale, GeneID)
        if (displayGeneID) hoverLabel.text(GeneID ?? '')
    })

    return plotArea.node()
}

const count_svg = plotUMAP(400, 300, count_umap_arr, "read_counts", "UMAP of read counts over 48hrs", true, bus)
const fft_svg = plotUMAP(400, 300, fft_umap_arr, "fft", "UMAP of FFT of waveforms", false, bus)

