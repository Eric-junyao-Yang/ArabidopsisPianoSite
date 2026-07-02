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

    const svg = d3.select('#'.concat(div_name))
        .append("svg")
        .attr('width', width)
        .attr('height', height)

    const plotArea = svg.append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`)

    // clip out of bounds points
    const clipId = `clip-${div_name}`

    // interactive portion
    const zoomRect = plotArea.append('rect')
        .attr('width', innerWidth)
        .attr('height', innerHeight)
        .style('fill', 'none')
        .style('pointer-events', 'all')

    const plotContent = plotArea.append("g")
        .attr("clip-path", `url(#${clipId})`)

    svg.append("defs").append("clipPath")
        .attr("id", clipId)
        .append("rect")
            .attr('width', innerWidth)
            .attr('height', innerHeight)

    const points = plotContent.selectAll('circle')
        .data(umap_arr)
        .join('circle')
        .attr('cx', d => xScale(d.x))
        .attr('cy', d => yScale(d.y))
        .attr('r', 2)
        .attr('fill', 'steelblue')
        .attr('opacity', 0.25)
        .on('mouseover', (event, d) => {
            bus.execute_event('point_hover', d.id) //emit point_hover signal
        })
        .on('mouseout', (event, d) => {
            bus.execute_event('point_hover', null) //emit point_hover signal
        })

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

    let rafId = null
    const zoom = d3.zoom()
        .scaleExtent([1, 20])
        .extent([[0, 0], [innerWidth, innerHeight]])
        .on("zoom", (event) => {
            const zx = event.transform.rescaleX(xScale)
            const zy = event.transform.rescaleY(yScale)
            if (rafId) cancelAnimationFrame(rafId)
            rafId = requestAnimationFrame(() => {
                points
                    .attr('cx', d => zx(d.x))
                    .attr('cy', d => zy(d.y))
        

            xAxis.call(d3.axisBottom(zx))
            yAxis.call(d3.axisLeft(zy))
            })
        })
        .on("end", (event) => {
            const zx = event.transform.rescaleX(xScale)
            const zy = event.transform.rescaleY(yScale)
            xAxis.call(d3.axisBottom(zx))
            yAxis.call(d3.axisLeft(zy))
        })

    plotArea.call(zoom)
    plotArea.on('dblclick.zoom', null)
    plotArea.on('dblclick', () => {
        plotArea.transition().duration(300).call(zoom.transform, d3.zoomIdentity)
    })

    //subscribe to bus events
    bus.subscribe_to("point_hover", div_name, (GeneID) => {
        points
            .attr('r', d => d.id === GeneID ? 8 : 2)
            .attr('fill', d => d.id === GeneID ? 'red' : 'steelblue')
        if (displayGeneID) hoverLabel.text(GeneID ?? '')
    })

    return plotArea.node()
}

const count_svg = plotUMAP(400, 300, count_umap_arr, "read_counts", "UMAP of read counts over 48hrs", true, bus)
const fft_svg = plotUMAP(400, 300, fft_umap_arr, "fft", "UMAP of FFT of waveforms", false, bus)

