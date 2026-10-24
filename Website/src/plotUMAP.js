// const originalGetContext = HTMLCanvasElement.prototype.getContext
// HTMLCanvasElement.prototype.getContext = function(type, ...args) {
//     if (type === 'webgl2') return null   // simulate no WebGL2
//     return originalGetContext.call(this, type, ...args)
// }

class ScatterGL {
    constructor(canvas, data, xScale, yScale, innerWidth, innerHeight, dpr) {
        this.data = data
        this.innerWidth = innerWidth
        this.innerHeight = innerHeight
        this.dpr = dpr

        this.physicalWidth = innerWidth * dpr
        this.physicalHeight = innerHeight * dpr

        this.gl = canvas.getContext('webgl2')
        if (!this.gl) return

        const gl = this.gl

        gl.enable(gl.BLEND)
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
        gl.viewport(0, 0, this.physicalWidth, this.physicalHeight)

        this._compileProgram()
        this._buildBuffers(xScale, yScale)
        this._getUniformLocations()
        this._setInitialUniforms(this.dpr, this.physicalWidth)

        this.render()
    }

    _compileProgram(){
        const gl = this.gl
        // vertex shader
        const vertSrc = `#version 300 es

            in vec2 quadVertex;          //input: corners per isntance  
            in vec2 instancePos;         //input: position in data space (0~1)
            in float selected;           //0.0 or 1.0 ; talks to outside
            
            out vec2 vUV;                // corner position doubles as UV bounds
            out float vSelected;         // talks between the two shaders

            uniform vec2 pointRadius;   // size of point
            uniform mat3 transform;      // transformation matrix

            void main() {
                vSelected = selected;
                vUV = quadVertex;

                vec3 transformed = transform * vec3(instancePos, 1.0);
                
                // to clip space
                vec2 clipPos = transformed.xy * 2.0 - 1.0;
                clipPos.y = - clipPos.y;
                
                gl_Position = vec4(clipPos + quadVertex * pointRadius, 0.0, 1.0); //output: where on screen
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
        this.program = gl.createProgram()
        gl.attachShader(this.program, vertShader)
        gl.attachShader(this.program, fragShader)
        gl.linkProgram(this.program)
        if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
            console.error('Program link error:', gl.getProgramInfoLog(this.program))
        }
        gl.useProgram(this.program)
    }

    _buildBuffers(xScale, yScale){
        const gl = this.gl
        const data = this.data
        const iW = this.innerWidth
        const iH = this.innerHeight

        // Set up coordinates (in data space)
        const instancePositions = new Float32Array(data.length * 2)
        for (let i=0; i < data.length; i++){
            instancePositions[i*2] = xScale(data[i].x) / iW
            instancePositions[i*2 + 1] = yScale(data[i].y) / iH
        }
        // Set up default selected array
        this.selectedArr = new Float32Array(data.length).fill(1.0)
        // Set up verticies
        const quadVerticies = new Float32Array([
            -1, -1,
            1, -1,
            -1, 1,
            1, 1,
        ])

        // Get Attribute Locations
        const quadVertexLoc = gl.getAttribLocation(this.program, 'quadVertex')
        const instancePosLoc = gl.getAttribLocation(this.program, 'instancePos') // Get which slot the position attribute is stored (int number)
        const selectedLoc = gl.getAttribLocation(this.program, 'selected')

        // ----- create VAO -----
        this.vao = gl.createVertexArray()
        gl.bindVertexArray(this.vao) // start recording

        // Quad Buffer
        const quadBuffer = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer)
        gl.bufferData(gl.ARRAY_BUFFER, quadVerticies, gl.STATIC_DRAW)
        gl.enableVertexAttribArray(quadVertexLoc)
        gl.vertexAttribPointer(quadVertexLoc, 2, gl.FLOAT, false, 0, 0)
        gl.vertexAttribDivisor(quadVertexLoc, 0) // advance once per vertex (its the default, technically this line is not needed)

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
        gl.vertexAttribDivisor(instancePosLoc, 1) // advance once per instance (i.e. repeat 6x as defined in drawArraysInstanced)

        // Color by Scrubber
        this.selectedBuffer = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, this.selectedBuffer)
        gl.bufferData(gl.ARRAY_BUFFER, this.selectedArr, gl.DYNAMIC_DRAW)
        gl.enableVertexAttribArray(selectedLoc)
        gl.vertexAttribPointer(
            selectedLoc,
            1,
            gl.FLOAT,
            false,
            0,
            0
        )
        gl.vertexAttribDivisor(selectedLoc, 1) // advance once per instance
        
        gl.bindVertexArray(null)
        // ---- end create VAO ---- 
    }

    _getUniformLocations() {
        const gl = this.gl
        this.renderPassLoc = gl.getUniformLocation(this.program, 'renderPass')
        this.transformLoc = gl.getUniformLocation(this.program, 'transform')
        this.pointRadiusLoc = gl.getUniformLocation(this.program, 'pointRadius')
    }

    _setInitialUniforms() {
        const gl = this.gl

        // point size
        const radiusPx = 4
        const rx = (radiusPx * this.dpr) / (this.physicalWidth / 2)
        const ry = (radiusPx * this.dpr) / (this.physicalHeight / 2)
        gl.uniform2f(this.pointRadiusLoc, rx, ry)

        // render pass
        gl.uniform1f(this.renderPassLoc, 0.0)

        // transform matrix
        const identityMatrix = new Float32Array([
            1, 0, 0,
            0, 1, 0,
            0, 0, 1,
        ])
        gl.uniformMatrix3fv(this.transformLoc, false, identityMatrix)
    }

    render(){
        const gl = this.gl

        gl.clearColor(0,0,0,0) //Defines what clear means
        gl.clear(gl.COLOR_BUFFER_BIT)
        gl.bindVertexArray(this.vao)

        //pass0
        gl.uniform1f(this.renderPassLoc, 0.0)
        gl.drawArraysInstanced(
            gl.TRIANGLE_STRIP,
            0, //start vertex
            4, //verticies per instance
            this.data.length)
        //pass1
        gl.uniform1f(this.renderPassLoc, 1.0)
        gl.drawArraysInstanced(
            gl.TRIANGLE_STRIP,
            0, //start vertex
            4, //verticies per instance
            this.data.length)

        gl.bindVertexArray(null)
    }

    updateTransform(d3Transform){
        const k = d3Transform.k
        const tx = d3Transform.x / this.innerWidth
        const ty = d3Transform.y / this.innerHeight

        const newMatrix = new Float32Array([
            k, 0, 0,
            0, k, 0,
            tx, ty, 1,
        ])

        this.gl.uniformMatrix3fv(this.transformLoc, false, newMatrix)
        this.render()
    }

    updateSelected(low_val, high_val){
        const data = this.data
        for (let i=0; i < data.length; i++){
            this.selectedArr[i] = (
                data[i].log_TPM >= low_val &&
                data[i].log_TPM <= high_val
            ) ? 1.0 : 0.0
        }
        const gl = this.gl
        gl.bindBuffer(gl.ARRAY_BUFFER, this.selectedBuffer)
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.selectedArr) //currently still re-writing whole buffer but does so inplace
        this.render()
    }

    get isSupported() {
        return !!this.gl
    }
}



export function plotUMAP(width, height, umap_arr, div_name, plot_title, displayGeneID = false, bus){

    const margin = { top: 20, right: 20, bottom: 40, left: 50 }
    const dpr = window.devicePixelRatio || 1 //1 css coordinate = typically 2x2 physical pixel
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

    const svg = d3.select(`#${div_name}`)
        .append("svg")
        .attr('width', width)
        .attr('height', height)
        .style('position', 'absolute')
        .style('top', '0')
        .style('left', '0')
        .style('pointer-events', 'none')
        // .style('outline', '2px solid red')

    const plotArea = svg.append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`)

    const mainCanvas = d3.select(`#${div_name}`)
        .append('canvas')
        .attr('width', physicalWidth)
        .attr('height', physicalHeight)
        .style('width', innerWidth + 'px')
        .style('height', innerHeight + 'px')
        .style('position', 'absolute')
        .style('top', margin.top + 'px')
        .style('left', margin.left + 'px')
        // .style('outline', '2px solid orange')

    // ---- WebGL ----
    const scatter = new ScatterGL(
        mainCanvas.node(),
        umap_arr,
        xScale,
        yScale,
        innerWidth,
        innerHeight,
        dpr
    )

    let [internal_low_val, internal_high_val] = yScale.domain()

    //CPU fallback
    function drawPointsCanvas(mainCtx, xSc, ySc, high_val = internal_high_val, low_val = internal_low_val) {
        //Clear canvas
        mainCtx.clearRect(0,0,innerWidth, innerHeight)

        mainCtx.fillStyle = "gray"
        mainCtx.beginPath()
        for (let i=0; i< umap_arr.length; i++){
            const d = umap_arr[i]
            if (d.log_TPM < low_val || d.log_TPM > high_val){
                mainCtx.moveTo(xSc(d.x) + 3, ySc(d.y))
                mainCtx.arc(xSc(d.x), ySc(d.y), 3, 0, 2 * Math.PI)
            }
        }
        mainCtx.fill()

        mainCtx.fillStyle = "steelblue"
        mainCtx.beginPath()
        for (let i=0; i< umap_arr.length; i++){
            const d = umap_arr[i]
            if (d.log_TPM >= low_val && d.log_TPM <= high_val){
                mainCtx.moveTo(xSc(d.x) + 3, ySc(d.y))
                mainCtx.arc(xSc(d.x), ySc(d.y), 3, 0, 2 * Math.PI)
            }
        }
        mainCtx.fill()
    }

    let mainCtx = null
    if (!scatter.isSupported) {
        //fallback
        console.warn('WebGL2 not supported, interactive visual elements may have slower performance with Canvas 2D')
        mainCtx = mainCanvas.node().getContext('2d', { willReadFrequently: true })
        mainCtx.scale(dpr, dpr)
    }

    const highlightCanvas = d3.select(`#${div_name}`)
        .append('canvas')
        .attr('width', innerWidth)
        .attr('height', innerHeight)
        .style('position', 'absolute')
        .style('top', margin.top + 'px')
        .style('left', margin.left + 'px')
        // .style('outline', '2px solid blue')
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

    // Build a quick look up from GeneID -> Index
    const GeneID_Lookup = new Map(umap_arr.map(r => [r.GeneID, r]))
    var GeneID_select_current = null

    function drawHighlight(xSc, ySc, GeneID_hover, GeneID_select) {
        hlightCtx.clearRect(0,0,innerWidth, innerHeight)
        if (GeneID_hover) {
            const d_hover = GeneID_Lookup.get(GeneID_hover)
            const cx_hover = xSc(d_hover.x)
            const cy_hover = ySc(d_hover.y)

            hlightCtx.beginPath()
            hlightCtx.arc(cx_hover, cy_hover, HighlightPointSize, 0, 2 * Math.PI)
            hlightCtx.fillStyle = 'rgba(68, 170, 153, 1)'
            hlightCtx.fill()
        }
        if (GeneID_select) {
            const d_select = GeneID_Lookup.get(GeneID_select)
            const cx_select = xSc(d_select.x)
            const cy_select = ySc(d_select.y)

            hlightCtx.beginPath()
            hlightCtx.arc(cx_select, cy_select, HighlightPointSize, 0, 2 * Math.PI)
            hlightCtx.fillStyle = 'rgba(221, 204, 119, 1)'
            hlightCtx.fill()
        }
    }

    if (!scatter.isSupported){drawPointsCanvas(mainCtx, xScale, yScale)}
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

    // Tell apart click from drag
    var mouseDownInit = null
    const DRAG_THRESHOLD = 4 //pixels
    // Tell single from double click
    var clickTimeout = null
    const DOUBLE_CLICK_GUARD = 150 //ms

    mainCanvas.on('mousedown', (event) => {
        const [mx, my] = d3.pointer(event)
        mouseDownInit = [mx, my]
    })

    mainCanvas.on('click', (event) => {
        if (!mouseDownInit) return
        
        const [mx, my] = d3.pointer(event)
        const dx = mx - mouseDownInit[0]
        const dy = my - mouseDownInit[1]
        const dist = Math.sqrt(dx*dx + dy*dy)
        mouseDownInit = null
        if (dist > DRAG_THRESHOLD) return
        
        
        if (clickTimeout) {
            clearTimeout(clickTimeout)
            clickTimeout = null
            return
        }

        clickTimeout = setTimeout(() => {
            clickTimeout = null
            const d = quadtree.find(mx, my, 4)
            if (d) {
                bus.execute_event('point_select', d.id)
            }
            else {
                bus.execute_event('point_select', null)
            }
        }, DOUBLE_CLICK_GUARD)
    })

    let rafId = null
    const zoom = d3.zoom()
        .scaleExtent([1, 20])
        .extent([[0, 0], [innerWidth, innerHeight]])
        .on("zoom", (event) => {
            const zx = event.transform.rescaleX(xScale)
            const zy = event.transform.rescaleY(yScale)

            if (rafId) cancelAnimationFrame(rafId)
            rafId = requestAnimationFrame(() => {
                if (!scatter.isSupported) {drawPointsCanvas(mainCtx, zx, zy, internal_high_val, internal_low_val)}
                else {scatter.updateTransform(event.transform)}
                bus.execute_event('point_hover', null)
                drawHighlight(zx, zy, lastEmittedRow?.id, GeneID_select_current)
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
            if (!scatter.isSupported) {drawPointsCanvas(mainCtx, zx, zy, internal_high_val, internal_low_val)}
            else {scatter.updateTransform(event.transform)}
            bus.execute_event('point_hover', null)
            drawHighlight(zx, zy, lastEmittedRow?.id, GeneID_select_current)
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
        drawHighlight(currentXScale, currentYScale, GeneID, GeneID_select_current)
        if (displayGeneID) hoverLabel.text(GeneID ?? '')
    })

    bus.subscribe_to("gene_filtering", div_name, ([high_val, low_val]) => {
        if (!scatter.isSupported) {
            drawPointsCanvas(mainCtx, currentXScale, currentYScale, high_val, low_val)
            internal_high_val = high_val
            internal_low_val = low_val
        }
        else {scatter.updateSelected(low_val, high_val)}
    })

    bus.subscribe_to("point_select", div_name, (GeneID) => {
        drawHighlight(currentXScale, currentYScale, GeneID, GeneID)
        GeneID_select_current = GeneID
    })

    return plotArea.node()
}