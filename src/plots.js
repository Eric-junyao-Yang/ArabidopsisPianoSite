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

const min_max_arr = await bin_to_array(
    "/run/media/yeti1t3y/Extreme SSD/My_Codes/ArabidopsisPiano/Processed_Data/min_max_norm.bin", 
    "/run/media/yeti1t3y/Extreme SSD/My_Codes/ArabidopsisPiano/Processed_Data/bin_meta.json"
)

const min_max_meta = await meta_to_json(
    "/run/media/yeti1t3y/Extreme SSD/My_Codes/ArabidopsisPiano/Processed_Data/bin_meta.json",
    "min_max_norm.bin"
)

const ids = min_max_meta.rownames
const logCount = min_max_arr.map((val, idx) => val.log_mean_count)
function append_id_logCount_to_array(input_array, list_of_id, list_of_logCount){
    return input_array.map((val, idx) => (
        {
            ...val, 
            log_mean_count: list_of_logCount[idx],
            id: list_of_id[idx]
        }
    ))
}

// Add the GeneID (id) field
count_umap_arr = append_id_logCount_to_array(count_umap_arr, ids, logCount)
fft_umap_arr = append_id_logCount_to_array(fft_umap_arr, ids, logCount)


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
    const dpr = window.devicePixelRatio || 1
    const innerWidth = width - margin.left - margin.right
    const innerHeight = height - margin.top - margin.bottom
    const physicalWidth = innerWidth * dpr
    const physicalHeight = innerHeight * dpr
    

    const xScale = d3.scaleLinear()
    .domain(d3.extent(umap_arr, d => d.x))
    .range([0, innerWidth])
    .nice()

    const yScale = d3.scaleLinear()
    .domain(d3.extent(umap_arr, d => d.y))
    .range([innerHeight, 0])
    .nice()

    //Allow current scale to be passed via bus
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
        .attr('width', physicalWidth)
        .attr('height', physicalHeight)
        .style('width', innerWidth + 'px')
        .style('height', innerHeight + 'px')
        .style('position', 'absolute')
        .style('top', margin.top + 'px')
        .style('left', margin.left + 'px')
        .style('outline', '2px solid orange')

    // ---- trying WebGL ----
    const gl = mainCanvas.node().getContext('webgl2')
    gl.enable(gl.BLEND)
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
    if (!gl) {
        //fallback
        console.warn('WebGL2 not supported, interactive visual elements may have slower performance with Canvas 2D')
        const mainCtx = mainCanvas.node().getContext('2d', { willReadFrequently: true })
        return
    }

    // vertex shader
    const vertSrc = `#version 300 es

        in vec2 quadVertex;          //input: corners per isntance  
        in vec2 instancePos;         //input: position in clip space
        in float selected;           //0.0 or 1.0 ; talks to outside
        
        out vec2 vUV;                // corner position doubles as UV bounds
        out float vSelected;         // talks between the two shaders

        uniform float pointRadius;   // size of point

        void main() {
            vSelected = selected;
            vUV = quadVertex;
            gl_Position = vec4(instancePos + quadVertex * pointRadius, 0.0, 1.0); //output: where on screen
        }
    `
    // fragment shader
    const fragSrc = `#version 300 es
        precision mediump float;

        in vec2 vUV;
        in float vSelected;
        out vec4 fragColor;

        uniform float renderPass;    // plot selected & unselected separately for overlap fixing

        void main() {
            if (renderPass > 0.5 && vSelected < 0.5) discard; // Pass0, keep selected
            if (renderPass < 0.5 && vSelected > 0.5) discard; // Pass1, keep unselected

            float dist = dot(vUV, vUV);
            if (dist > 1.0) discard;

            float alpha = smoothstep(1.0, 0.8, dist);

            if (vSelected > 0.5) {
                    fragColor = vec4(0.8, 0.4, 0.47, alpha); //vec4(0.27, 0.67, 0.6, 1.0)
                } else {
                    fragColor = vec4(0.6, 0.6, 0.6, alpha * 0.8);    
                }
        }
    `
    function compileShader(type, src){
        const shader = gl.createShader(type) //allocate blank shader (vertex or fragment) object to GPU
        gl.shaderSource(shader, src) //upload glsl string above
        gl.compileShader(shader)
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader compile error:', gl.getShaderInfoLog(shader))
            gl.deleteShader(shader)
            return null
        }
        return shader
    }

    const vertShader = compileShader(gl.VERTEX_SHADER, vertSrc)
    const fragShader = compileShader(gl.FRAGMENT_SHADER, fragSrc)

    //link two shaders together into one program
    const program = gl.createProgram()
    gl.attachShader(program, vertShader)
    gl.attachShader(program, fragShader)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Program link error:', gl.getProgramInfoLog(program))
    }

    gl.useProgram(program)

    // Set up point size
    const radiusPx = 4
    const pointRadius = (radiusPx * dpr) / (physicalWidth / 2)
    const pointRadiusLoc = gl.getUniformLocation(program, 'pointRadius')
    gl.uniform1f(pointRadiusLoc, pointRadius) 

    // Set up verticies
    const quadVerticies = new Float32Array([
        -1, -1,
        1, -1,
        -1, 1,
        1, 1,
    ])

    // Set up coordinates (in clip space)
    const instancePositions = new Float32Array(umap_arr.length * 2)
    for (let i=0; i < umap_arr.length; i++){
        const px = xScale(umap_arr[i].x)
        const py = yScale(umap_arr[i].y)

        instancePositions[i*2] = (px / innerWidth) * 2 - 1
        instancePositions[i*2 + 1] = -(py / innerHeight) * 2 + 1
    }

    // Set up default selected array
    const selectedArr = new Float32Array(umap_arr.length).fill(1.0)

    // Get Attribute Locations
    const quadVertexLoc = gl.getAttribLocation(program, 'quadVertex')
    const instancePosLoc = gl.getAttribLocation(program, 'instancePos') // Get which slot the position attribute is stored (int number)
    const selectedLoc = gl.getAttribLocation(program, 'selected')
    const renderPassLoc = gl.getUniformLocation(program, 'renderPass')

    // ----- create VAO -----
    const vao = gl.createVertexArray()
    gl.bindVertexArray(vao) // start recording

    // Quad Buffer
    const quadBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, quadVerticies, gl.STATIC_DRAW)
    gl.enableVertexAttribArray(quadVertexLoc)
    gl.vertexAttribPointer(quadVertexLoc, 2, gl.FLOAT, false, 0, 0)
    gl.vertexAttribDivisor(instancePosLoc, 0) // advance once per vertex (its the default, technically this line is not needed)

    // Position Buffer
    const positionBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer) //set active buffer
    gl.bufferData(gl.ARRAY_BUFFER, instancePositions, gl.STATIC_DRAW) //upload data
    // note, this binds the Attribute (i.e. position) to the buffer that's currently created
    // so now attribute slot n = read from positionBuffer according to rule specified below
    gl.enableVertexAttribArray(instancePosLoc)
    gl.vertexAttribPointer( // always read from ARRAY_BUFFER
        instancePosLoc, // the data being read goes into this slot (i.e. represents position)
        2, // 2 consecutive floats (x,y)
        gl.FLOAT,
        false, // skip normalization for floats
        0, // stride 0 (points are adjacent with no padding)
        0 // no offset, read from start
    )
    gl.vertexAttribDivisor(selectedLoc, 1) // advance once per instance (i.e. repeat 6x as defined in drawArraysInstanced)

    // Color by Scrubber
    const selectedBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, selectedBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, selectedArr, gl.DYNAMIC_DRAW)
    gl.enableVertexAttribArray(selectedLoc)
    gl.vertexAttribPointer(
        selectedLoc,
        1,
        gl.FLOAT,
        false,
        0,
        0
    )
    gl.vertexAttribDivisor(instancePosLoc, 1) // advance once per instance
    
    gl.bindVertexArray(null)
    // ---- create VAO ---- 

    function renderGL() {
        gl.clearColor(0,0,0,0) //Defines what clear means
        gl.clear(gl.COLOR_BUFFER_BIT)
        gl.bindVertexArray(vao)

        //pass0
        gl.uniform1f(renderPassLoc, 0.0)
        gl.drawArraysInstanced(
            gl.TRIANGLE_STRIP,
            0, //start vertex
            4, //verticies per instance
            umap_arr.length)
        //pass1
        gl.uniform1f(renderPassLoc, 1.0)
        gl.drawArraysInstanced(
            gl.TRIANGLE_STRIP,
            0, //start vertex
            4, //verticies per instance
            umap_arr.length)

        gl.bindVertexArray(null)
    }

    renderGL()


    function updateSelected(low_val, high_val) {
        for (let i=0; i < umap_arr.length; i++){
            selectedArr[i] = (
                umap_arr[i].log_mean_count >= low_val &&
                umap_arr[i].log_mean_count <= high_val
            ) ? 1.0 : 0.0
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, selectedBuffer)
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, selectedArr) //currently still re-writing whole buffer but does so inplace

        renderGL()
    }
    
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

    
    const hlightCtx = highlightCanvas.node().getContext('2d')

    const notHighlightPointSize = 2
    const HighlightPointSize = 6

    //CPU fallback
    function drawPointsCanvas(xSc, ySc, high_val = null, low_val = null) {
        //Clear canvas
        mainCtx.clearRect(0,0,innerWidth, innerHeight)

        umap_arr.forEach((d,i) => {
            const cx = xSc(d.x)
            const cy = ySc(d.y)

            if (cx < 0 || cx > innerWidth || cy < 0 || cy > innerHeight) return


            mainCtx.beginPath()
            mainCtx.arc(cx, cy, notHighlightPointSize, 0, 2 * Math.PI)
            if (high_val && low_val){
                if (d.log_mean_count < high_val && d.log_mean_count > low_val){
                    mainCtx.fillStyle = 'rgba(255,0,0,1)'
                } else {mainCtx.fillStyle = 'rgba(255,0,0,0)'}
            } else {mainCtx.fillStyle = 'rgba(255,0,0,1)'}
            
            mainCtx.fill()
        })

        // mainCtx.fillStyle = "steelblue"
        // mainCtx.beginPath()
        // for (let i=0; i< umap_arr.length; i++){
        //     const d = umap_arr[i]
        //     if (d.log_mean_count < low_val || d.log_mean_count > high_val){
        //         mainCtx.moveTo(xSc(d.x) + 3, ySc(d.y))
        //         mainCtx.arc(xSc(d.x), ySc(d.y), 3, 0, 2 * Math.PI)
        //     }
        // }
        // mainCtx.fill()

        // mainCtx.fillStyle = "purple"
        // mainCtx.beginPath()
        // for (let i=0; i< umap_arr.length; i++){
        //     const d = umap_arr[i]
        //     if (d.log_mean_count >= low_val && d.log_mean_count <= high_val){
        //         mainCtx.moveTo(xSc(d.x) + 3, ySc(d.y))
        //         mainCtx.arc(xSc(d.x), ySc(d.y), 3, 0, 2 * Math.PI)
        //     }
        // }
        // mainCtx.fill()
    }

    // Build a quick look up from GeneID -> Index
    const GeneID_Lookup = new Map(umap_arr.map(r => [r.id, r]))

    function drawHighlight(xSc, ySc, GeneID) {
        hlightCtx.clearRect(0,0,innerWidth, innerHeight)
        if (GeneID) {
            const d = GeneID_Lookup.get(GeneID)
            const cx = xSc(d.x)
            const cy = ySc(d.y)

            hlightCtx.beginPath()
            hlightCtx.arc(cx, cy, HighlightPointSize, 0, 2 * Math.PI)
            hlightCtx.fillStyle = 'red'
            hlightCtx.fill()
        }
    }

    if (!gl){drawPointsCanvas(xScale, yScale)}
    //TODO
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

    function updatePositions(xSc, ySc) {
        for (let i=0; i < umap_arr.length; i++){
            const px = xSc(umap_arr[i].x)
            const py = ySc(umap_arr[i].y)

            instancePositions[i * 2] = (px / innerWidth) * 2 - 1
            instancePositions[i * 2 + 1] = - (py / innerHeight) * 2 + 1
        }

        gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer)
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, instancePositions)

        renderGL()
    }

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
                if (!gl) {drawPointsCanvas(zx, zy)}
                else {updatePositions(zx, zy)}
                bus.execute_event('point_hover', null)
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
            if (!gl) {drawPointsCanvas(zx, zy)}
            else {updatePositions(zx, zy)}
            bus.execute_event('point_hover', null)
            rebuildQuadtree(zx, zy)   
            xAxis.call(d3.axisBottom(zx))
            yAxis.call(d3.axisLeft(zy))
        })

    mainCanvas.call(zoom)
    mainCanvas.on('dblclick.zoom', null)
    mainCanvas.on('dblclick', () => {
        mainCanvas.transition().duration(500).call(zoom.transform, d3.zoomIdentity)
    })

    function applyFilter(high_val, low_val){

    }


    //subscribe to bus events
    bus.subscribe_to("point_hover", div_name, (GeneID) => {
        drawHighlight(currentXScale, currentYScale, GeneID)
        if (displayGeneID) hoverLabel.text(GeneID ?? '')
    })

    bus.subscribe_to("gene_filtering", div_name, ([high_val, low_val]) => {
        if (!gl) {drawPointsCanvas(currentXScale, currentYScale, high_val, low_val)}
        else {updateSelected(low_val, high_val)}
    })

    return plotArea.node()
}

const logMeanArr = min_max_arr

function plotViolin(width, height, logMeanArr, div_name){
    const margin = { top: 20, right: 20, bottom: 20, left: 50 }
    const innerWidth = width - margin.left - margin.right
    const innerHeight = height - margin.top - margin.bottom

    const svg = d3.select("#" + div_name)
        .append("svg")
            .attr("width", width)
            .attr("height", height)
        .style('outline', '2px solid salmon')
    
        const plotArea = svg.append("g")
            .attr("transform", `translate(${margin.left},${margin.top})`)
    
    const yScale = d3.scaleLinear()
        .domain(d3.extent(logMeanArr, d => d.log_mean_count))
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
        .text("log(average count over 48hrs)")

    const histogram = d3.histogram()
        .domain(yScale.domain())
        .thresholds(yScale.ticks(20))
        .value(d => d.log_mean_count)

    const bins = histogram(logMeanArr)   
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
        const qval = quantile(logMeanArr, quant)
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
    let [low_val, high_val] = [ymin, ymax] // The all these vals are in log(mean_count)

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

        bus.execute_event("gene_filtering", [high_val, low_val])
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
    const new_arr = new Array(arr.length)
    arr.map((val, idx) => {
        new_arr[idx] = val.log_mean_count
    })
    const sorted = asc(new_arr);
    const pos = (sorted.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (sorted[base + 1] !== undefined) {
        return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
    } else {
        return sorted[base];
    }
};



const count_svg = plotUMAP(400, 300, count_umap_arr, "read_counts", "UMAP of read counts over 48hrs", true, bus)
const fft_svg = plotUMAP(400, 300, fft_umap_arr, "fft", "UMAP of FFT of waveforms", false, bus)
plotViolin(100, 300, logMeanArr, "filter_slider")