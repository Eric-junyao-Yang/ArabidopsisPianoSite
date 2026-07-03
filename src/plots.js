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

    //Set up svg (axis + titles etc) & visCanvas (points) & hitCanvas(rgb code)

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

    const visCanvas = d3.select("#" + div_name)
        .append('canvas')
        .attr('width', innerWidth)
        .attr('height', innerHeight)
        .style('position', 'absolute')
        .style('top', margin.top + 'px')
        .style('left', margin.left + 'px')
        .style('outline', '2px solid orange')
    
    const hitCanvas = d3.select("#" + div_name)
        .append('canvas')
        .attr('width', innerWidth)
        .attr('height', innerHeight)
        .style('position', 'absolute')
        .style('top', margin.top + 'px')
        .style('left', margin.left + 'px')
        .style('opacity', 0)
        .style('pointer-events', 'none')
        .style('outline', '2px solid blue')
    
    const visCtx = visCanvas.node().getContext('2d')
    const hitCtx = hitCanvas.node().getContext('2d', { willReadFrequently: true })

    let currentHighlight = null
    
    const notHighlightPointSize = 2
    const HighlightPointSize = 6

    function drawPoints(xSc, ySc) {
        //Clear canvas
        visCtx.clearRect(0,0,innerWidth, innerHeight)
        hitCtx.clearRect(0,0,innerWidth, innerHeight)

        umap_arr.forEach((d,i) => {
            const cx = xSc(d.x)
            const cy = ySc(d.y)

            if (cx < 0 || cx > innerWidth || cy < 0 || cy > innerHeight) return

            const isHighlighted = d.id === currentHighlight

            visCtx.beginPath()
            visCtx.arc(cx, cy, isHighlighted ? HighlightPointSize : notHighlightPointSize, 0, 2 * Math.PI)
            visCtx.fillStyle = isHighlighted? 'red' : 'steelblue'
            visCtx.fill()

            hitCtx.beginPath()
            hitCtx.arc(cx, cy, notHighlightPointSize + 2, 0, 2 * Math.PI)
            hitCtx.fillStyle = indexToColor(i)
            hitCtx.fill()
        })
    }

    drawPoints(xScale, yScale)

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

    let lastEmitted = null

    visCanvas.on('mousemove', (event) => {
        const [mx, my] = d3.pointer(event)
        const [r,g,b,a] = hitCtx.getImageData(mx, my, 1, 1).data
        console.log(r,g,b,a)

        if ( a !== 255 ) {
            if (lastEmitted !== null) {
                lastEmitted = null
                bus.execute_event('point_hover', null)
            }
            return
        }

        const idx = colorToIndex(r,g,b)
        if (idx < 0 || idx >= umap_arr.length) return //safety check
        const d = umap_arr[idx]
        if (!d) return

        if (d.id !== lastEmitted){
            lastEmitted = d.id
            bus.execute_event('point_hover', d.id)
        }
    })

    visCanvas.on('mouseleave', () => {
        if (lastEmitted !== null) {
            lastEmitted = null
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
            xAxis.call(d3.axisBottom(zx))
            yAxis.call(d3.axisLeft(zy))
        })

    visCanvas.call(zoom)
    visCanvas.on('dblclick.zoom', null)
    visCanvas.on('dblclick', () => {
        visCanvas.transition().duration(500).call(zoom.transform, d3.zoomIdentity)
    })

    //subscribe to bus events
    bus.subscribe_to("point_hover", div_name, (GeneID) => {
        currentHighlight = GeneID
        drawPoints(currentXScale, currentYScale)
        if (displayGeneID) hoverLabel.text(GeneID ?? '')
    })

    return plotArea.node()
}

const count_svg = plotUMAP(400, 300, count_umap_arr, "read_counts", "UMAP of read counts over 48hrs", true, bus)
const fft_svg = plotUMAP(400, 300, fft_umap_arr, "fft", "UMAP of FFT of waveforms", false, bus)

