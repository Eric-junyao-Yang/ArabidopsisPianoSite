// const originalGetContext = HTMLCanvasElement.prototype.getContext
// HTMLCanvasElement.prototype.getContext = function(type, ...args) {
//     if (type === 'webgl2') return null   // simulate no WebGL2
//     return originalGetContext.call(this, type, ...args)
// }

import { PALETTE, THEME, hexToRgb01, withAlpha, drawAxis, axisLabel, plotTitle, containerSize, onResize } from "/src/plotTheme.js"
import { energyPctAtPeriod } from "/src/plotHarmonics.js"

// Point RGB is set by color mode; selected/inactive = TPM filter (orthogonal).
const INACTIVE_RGB = hexToRgb01(THEME.pointInactive).map((v) => v.toFixed(4)).join(", ")
const OUTLINE_RGB = hexToRgb01(THEME.ink).map((v) => v.toFixed(4)).join(", ")
const ACTIVE_ALPHA = 0.55
const INACTIVE_ALPHA = 0.4
const OUTLINE_ALPHA = 0.7
const POINT_RADIUS_PX = 4
const POINT_OUTLINE_PX = 1
// Fill disk as a fraction of the drawn quad (outline sits in the outer ring).
const FILL_RADIUS_FRAC = POINT_RADIUS_PX / (POINT_RADIUS_PX + POINT_OUTLINE_PX)
const QVAL_CUTOFF = 0.05
const PHASE_PERIOD_H = 24
const DEFAULT_ENERGY_PERIOD_H = 24

// Cyclic hue wheel for peak phase (0h ≡ 24h). Standard for circular quantities.
const PHASE_INTERPOLATOR = d3.interpolateHslLong(
    d3.hsl(0, 0.75, 0.5),
    d3.hsl(360, 0.75, 0.5),
)
// Sequential Inferno: low → high significance (−log10 LS_qval). Hotter = more significant.
const QVAL_INTERPOLATOR = d3.interpolateInferno
const QVAL_NEGLOG10_MAX = 5
// Sequential Viridis: low → high energy share at the selected period.
const ENERGY_INTERPOLATOR = d3.interpolateViridis

function rgb01ToCss([r, g, b], a = 1) {
    return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${a})`
}

function interpToRgb01(interpolator, t) {
    const c = d3.rgb(interpolator(Math.max(0, Math.min(1, t))))
    return [c.r / 255, c.g / 255, c.b / 255]
}

function phaseToRgb01(phaseHours) {
    const t = (((phaseHours % PHASE_PERIOD_H) + PHASE_PERIOD_H) % PHASE_PERIOD_H) / PHASE_PERIOD_H
    return interpToRgb01(PHASE_INTERPOLATOR, t)
}

function qvalToRgb01(q) {
    const negLog = -Math.log10(Math.max(q, 1e-300))
    return interpToRgb01(QVAL_INTERPOLATOR, negLog / QVAL_NEGLOG10_MAX)
}

/** Map energy share in [0, 1] → RGB. */
function energyShareToRgb01(energyShare) {
    return interpToRgb01(ENERGY_INTERPOLATOR, energyShare)
}

/** Currently selected harmonic period (hours) from the oscillation-energy radios. */
export function selectedEnergyPeriodHours() {
    const el = document.querySelector('input[name="oscillation_energy"]:checked')
    const period = el ? Number(el.value) : DEFAULT_ENERGY_PERIOD_H
    return Number.isFinite(period) ? period : DEFAULT_ENERGY_PERIOD_H
}

/** Build per-point RGB (length n*3) for a color mode. Filter is applied separately via selected. */
function buildColorRgbArr(mode, umap_arr, metaByGene, specsLookup) {
    const n = umap_arr.length
    const rgb = new Float32Array(n * 3)
    const defaultRgb = hexToRgb01(THEME.pointActive)
    const sigRgb = hexToRgb01(PALETTE.teal)
    const nsigRgb = hexToRgb01(THEME.pointActive)
    const periodHours = mode === "energyPct" ? selectedEnergyPeriodHours() : null

    for (let i = 0; i < n; i++) {
        const meta = metaByGene.get(umap_arr[i].GeneID)
        let col = defaultRgb
        if (mode === "circadian") {
            const q = meta?.metacycle_qval
            col = (q != null && q <= QVAL_CUTOFF) ? sigRgb : nsigRgb
        } else if (mode === "phase") {
            const phase = meta?.phase
            col = (phase != null && Number.isFinite(phase)) ? phaseToRgb01(phase) : defaultRgb
        } else if (mode === "qval") {
            const q = meta?.LS_qval
            col = (q != null && Number.isFinite(q)) ? qvalToRgb01(q) : defaultRgb
        } else if (mode === "energyPct") {
            const energyPct = energyPctAtPeriod(umap_arr[i].GeneID, specsLookup, periodHours)
            col = (energyPct != null && Number.isFinite(energyPct))
                ? energyShareToRgb01(energyPct / 100)
                : defaultRgb
        }
        rgb[i * 3] = col[0]
        rgb[i * 3 + 1] = col[1]
        rgb[i * 3 + 2] = col[2]
    }
    return rgb
}

class ScatterGL {
    constructor(canvas, data, colorRgbArr, xScale, yScale, innerWidth, innerHeight, dpr) {
        this.data = data
        this.colorRgbArr = colorRgbArr
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
            in float selected;           //0.0 or 1.0 ; TPM filter
            in vec3 instanceColor;       // per-point RGB from color mode
            
            out vec2 vUV;                // corner position doubles as UV bounds
            out float vSelected;         // talks between the two shaders
            out vec3 vColor;

            uniform vec2 pointRadius;   // size of point
            uniform mat3 transform;      // transformation matrix

            void main() {
                vSelected = selected;
                vColor = instanceColor;
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
            in vec3 vColor;
            out vec4 fragColor;

            uniform float renderPass;    // plot selected & unselected separately for overlap fixing

            void main() {
                if (renderPass > 0.5 && vSelected < 0.5) discard; // Pass0, keep selected
                if (renderPass < 0.5 && vSelected > 0.5) discard; // Pass1, keep unselected

                float r = length(vUV);
                if (r > 1.0) discard;

                // Inner fill + thin dark ring so bright colormap colors stay readable on white.
                float fillR = ${FILL_RADIUS_FRAC.toFixed(4)};
                float aa = 0.08;
                float fillMask = 1.0 - smoothstep(fillR - aa, fillR + aa, r);
                float strokeMask = smoothstep(fillR - aa, fillR + aa, r)
                    * (1.0 - smoothstep(1.0 - aa, 1.0, r));

                vec3 fillRgb = vSelected > 0.5 ? vColor : vec3(${INACTIVE_RGB});
                float fillA = (vSelected > 0.5 ? ${ACTIVE_ALPHA.toFixed(2)} : ${INACTIVE_ALPHA.toFixed(2)}) * fillMask;
                float strokeA = ${OUTLINE_ALPHA.toFixed(2)} * strokeMask;

                // Premultiplied composite: fill over outline ring
                float outA = fillA + strokeA * (1.0 - fillA);
                vec3 outRgb = (fillRgb * fillA + vec3(${OUTLINE_RGB}) * strokeA * (1.0 - fillA))
                    / max(outA, 1e-5);
                fragColor = vec4(outRgb, outA);
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
        const colorLoc = gl.getAttribLocation(this.program, 'instanceColor')

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

        // TPM scrubber → selected / inactive (dynamic)
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

        // Per-point RGB from color mode (updated when mode changes; filter stays separate)
        this.colorBuffer = gl.createBuffer()
        gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer) //set active buffer
        gl.bufferData(gl.ARRAY_BUFFER, this.colorRgbArr, gl.DYNAMIC_DRAW) //upload data to GPU
        gl.enableVertexAttribArray(colorLoc)
        gl.vertexAttribPointer(colorLoc, 3, gl.FLOAT, false, 0, 0) // read 3 consecutive floats (RGB) from ARRAY_BUFFER
        gl.vertexAttribDivisor(colorLoc, 1) // advance once per instance (gene)
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

        // point size includes outline ring outside the fill disk
        const radiusPx = POINT_RADIUS_PX + POINT_OUTLINE_PX
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

    updateColors(colorRgbArr){
        this.colorRgbArr = colorRgbArr
        const gl = this.gl
        gl.bindBuffer(gl.ARRAY_BUFFER, this.colorBuffer)
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.colorRgbArr)
        this.render()
    }

    destroy() {
        // Free the GPU context so repeated resizes don't exhaust the browser's WebGL context limit
        this.gl?.getExtension('WEBGL_lose_context')?.loseContext()
    }

    get isSupported() {
        return !!this.gl
    }
}



// width/height are fallbacks: the plot fills its container and redraws (keeping filter + selection)
// when the container is resized.
export function plotUMAP(width, height, umap_arr, per_gene_meta, specsLookup, div_name, plot_title, displayGeneID = false, bus){
    const container = document.getElementById(div_name)
    // State that must survive a redraw
    const state = { low: null, high: null, selected: null, colorMode: "none" }
    let current = null

    function redraw() {
        current?.destroy()
        // keep non-plot children (e.g. the help button added by helpPopup.js)
        container.querySelectorAll(':scope > svg, :scope > canvas').forEach((n) => n.remove())
        const [w, h] = containerSize(container, width, height)
        current = buildUMAP(w, h, umap_arr, per_gene_meta, specsLookup, div_name, plot_title, displayGeneID, bus, state)
    }
    redraw()
    onResize(container, redraw)
    return current.node
}

function buildUMAP(width, height, umap_arr, per_gene_meta, specsLookup, div_name, plot_title, displayGeneID, bus, state){

    const margin = { top: 34, right: 16, bottom: 40, left: 46 }
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

    const metaByGene = new Map(per_gene_meta.map((d) => [d.GeneID, d]))
    let colorRgbArr = buildColorRgbArr(state.colorMode, umap_arr, metaByGene, specsLookup)

    // ---- WebGL ----
    const scatter = new ScatterGL(
        mainCanvas.node(),
        umap_arr,
        colorRgbArr,
        xScale,
        yScale,
        innerWidth,
        innerHeight,
        dpr
    )

    let [internal_low_val, internal_high_val] = yScale.domain()
    if (state.low !== null) { internal_low_val = state.low; internal_high_val = state.high }

    // CPU fallback — inactive batch, then per-point active colors
    function drawPointsCanvas(mainCtx, xSc, ySc, high_val = internal_high_val, low_val = internal_low_val) {
        mainCtx.clearRect(0, 0, innerWidth, innerHeight)
        mainCtx.lineWidth = POINT_OUTLINE_PX
        mainCtx.strokeStyle = withAlpha(THEME.ink, OUTLINE_ALPHA)

        mainCtx.fillStyle = withAlpha(THEME.pointInactive, INACTIVE_ALPHA)
        mainCtx.beginPath()
        for (let i = 0; i < umap_arr.length; i++) {
            const d = umap_arr[i]
            if (d.log_TPM >= low_val && d.log_TPM <= high_val) continue
            mainCtx.moveTo(xSc(d.x) + POINT_RADIUS_PX, ySc(d.y))
            mainCtx.arc(xSc(d.x), ySc(d.y), POINT_RADIUS_PX, 0, 2 * Math.PI)
        }
        mainCtx.fill()
        mainCtx.stroke()

        for (let i = 0; i < umap_arr.length; i++) {
            const d = umap_arr[i]
            if (d.log_TPM < low_val || d.log_TPM > high_val) continue
            mainCtx.fillStyle = rgb01ToCss(
                [colorRgbArr[i * 3], colorRgbArr[i * 3 + 1], colorRgbArr[i * 3 + 2]],
                ACTIVE_ALPHA,
            )
            mainCtx.beginPath()
            mainCtx.arc(xSc(d.x), ySc(d.y), POINT_RADIUS_PX, 0, 2 * Math.PI)
            mainCtx.fill()
            mainCtx.stroke()
        }
    }

    function applyColorMode(mode) {
        state.colorMode = mode
        colorRgbArr = buildColorRgbArr(mode, umap_arr, metaByGene, specsLookup)
        if (scatter.isSupported) scatter.updateColors(colorRgbArr)
        else if (mainCtx) drawPointsCanvas(mainCtx, currentXScale, currentYScale)
        renderColorLegend(mode)
    }

    if (state.low !== null && scatter.isSupported) scatter.updateSelected(state.low, state.high)

    let mainCtx = null
    if (!scatter.isSupported) {
        //fallback
        console.warn('WebGL2 not supported, interactive visual elements may have slower performance with Canvas 2D')
        mainCtx = mainCanvas.node().getContext('2d', { willReadFrequently: true })
        mainCtx.scale(dpr, dpr)
    }

    const highlightCanvas = d3.select(`#${div_name}`)
        .append('canvas')
        .attr('width', physicalWidth)
        .attr('height', physicalHeight)
        .style('width', innerWidth + 'px')
        .style('height', innerHeight + 'px')
        .style('position', 'absolute')
        .style('top', margin.top + 'px')
        .style('left', margin.left + 'px')
        // .style('outline', '2px solid blue')
        .style('pointer-events', 'none')
    
    let quadtree = null
    


    function rebuildQuadtree(xSc, ySc) {
        // Inclusive bounds — must match drawPointsCanvas / updateSelected
        const passed = umap_arr.filter(
            (d) => d.log_TPM >= internal_low_val && d.log_TPM <= internal_high_val
        )
        quadtree = d3.quadtree()
            .x(d => xSc(d.x))
            .y(d => ySc(d.y))
            .addAll(passed)
    }

    
    const hlightCtx = highlightCanvas.node().getContext('2d')
    hlightCtx.scale(dpr, dpr) // crisp markers on retina screens

    const HighlightPointSize = 5.5

    // Build a quick look up from GeneID -> Index
    const GeneID_Lookup = new Map(umap_arr.map(r => [r.GeneID, r]))
    var GeneID_select_current = state.selected

    // White halo + dark ring keeps the marker visible on dense, same-colored clusters
    function drawMarker(x, y, fill, r) {
        hlightCtx.beginPath()
        hlightCtx.arc(x, y, r + 2, 0, 2 * Math.PI)
        hlightCtx.fillStyle = 'rgba(255, 255, 255, 0.9)'
        hlightCtx.fill()
        hlightCtx.beginPath()
        hlightCtx.arc(x, y, r, 0, 2 * Math.PI)
        hlightCtx.fillStyle = fill
        hlightCtx.fill()
        hlightCtx.lineWidth = 1.5
        hlightCtx.strokeStyle = THEME.ink
        hlightCtx.stroke()
    }

    function drawHighlight(xSc, ySc, GeneID_hover, GeneID_select) {
        hlightCtx.clearRect(0,0,innerWidth, innerHeight)
        if (GeneID_hover) {
            const d_hover = GeneID_Lookup.get(GeneID_hover)
            if (d_hover) drawMarker(xSc(d_hover.x), ySc(d_hover.y), THEME.hover, HighlightPointSize)
        }
        if (GeneID_select) {
            const d_select = GeneID_Lookup.get(GeneID_select)
            if (d_select) drawMarker(xSc(d_select.x), ySc(d_select.y), THEME.selected, HighlightPointSize)
        }
    }

    if (!scatter.isSupported){drawPointsCanvas(mainCtx, xScale, yScale)}

    rebuildQuadtree(xScale, yScale)

    const xAxis = plotArea.append('g')
        .attr('transform', `translate(0, ${innerHeight})`)
    const yAxis = plotArea.append("g")
    const xAxisGen = (sc) => d3.axisBottom(sc).ticks(Math.max(3, Math.floor(innerWidth / 80))).tickSizeOuter(0)
    const yAxisGen = (sc) => d3.axisLeft(sc).ticks(Math.max(3, Math.floor(innerHeight / 60))).tickSizeOuter(0)
    drawAxis(xAxis, xAxisGen(xScale))
    drawAxis(yAxis, yAxisGen(yScale))

    axisLabel(plotArea.append("text")
        .attr("x", innerWidth / 2)
        .attr("y", innerHeight + 32))
        .text("dim1")

    axisLabel(plotArea.append("text")
        .attr("transform", "rotate(-90)")
        .attr("x", - innerHeight/2)
        .attr("y", -34))
        .text("dim2")

    plotTitle(plotArea.append("text")
        .attr("x", 0)
        .attr("y", -16))
        .text(plot_title)

    const legend = plotArea.append("g").attr("class", "umap-color-legend")
        .attr("transform", `translate(${innerWidth - 4}, 8)`)

    function drawContinuousLegend(gradId, interpolator, leftLabel, rightLabel, title) {
        const barW = 88
        const barH = 10
        let defs = svg.select(":scope > defs")
        if (defs.empty()) defs = svg.insert("defs", ":first-child")
        defs.select(`#${gradId}`).remove()
        const grad = defs.append("linearGradient").attr("id", gradId)
            .attr("x1", "0%").attr("x2", "100%")
        const stops = 12
        for (let i = 0; i <= stops; i++) {
            const t = i / stops
            grad.append("stop")
                .attr("offset", `${t * 100}%`)
                .attr("stop-color", interpolator(t))
        }
        legend.append("rect")
            .attr("x", -barW - 8).attr("y", 0)
            .attr("width", barW).attr("height", barH)
            .attr("rx", 2)
            .attr("fill", `url(#${gradId})`)
        legend.append("text")
            .attr("x", -barW - 8).attr("y", barH + 11)
            .attr("fill", THEME.muted).attr("font-size", 9)
            .style("font-family", THEME.fontMono)
            .text(leftLabel)
        legend.append("text")
            .attr("x", -8).attr("y", barH + 11)
            .attr("text-anchor", "end")
            .attr("fill", THEME.muted).attr("font-size", 9)
            .style("font-family", THEME.fontMono)
            .text(rightLabel)
        legend.append("text")
            .attr("x", -8).attr("y", barH + 24)
            .attr("text-anchor", "end")
            .attr("fill", THEME.muted).attr("font-size", 9)
            .style("font-family", THEME.fontMono)
            .text(title)
        const filt = legend.append("g").attr("transform", `translate(0, ${barH + 38})`)
        filt.append("circle").attr("cx", -8).attr("cy", 0).attr("r", 4).attr("fill", THEME.pointInactive)
        filt.append("text")
            .attr("x", -16).attr("y", 0).attr("dy", "0.35em")
            .attr("text-anchor", "end")
            .attr("fill", THEME.muted).attr("font-size", 10)
            .style("font-family", THEME.fontMono)
            .text("filtered out")
    }

    function renderColorLegend(mode) {
        legend.selectAll("*").remove()
        if (mode === "none") return

        if (mode === "circadian") {
            const items = [
                { label: `q ≤ ${QVAL_CUTOFF}`, color: PALETTE.teal },
                { label: `q > ${QVAL_CUTOFF}`, color: THEME.pointActive },
                { label: "filtered out", color: THEME.pointInactive },
            ]
            items.forEach((item, i) => {
                const row = legend.append("g").attr("transform", `translate(0, ${i * 14})`)
                row.append("circle").attr("cx", -8).attr("cy", 0).attr("r", 4).attr("fill", item.color)
                row.append("text")
                    .attr("x", -16).attr("y", 0).attr("dy", "0.35em")
                    .attr("text-anchor", "end")
                    .attr("fill", THEME.muted)
                    .attr("font-size", 10)
                    .style("font-family", THEME.fontMono)
                    .text(item.label)
            })
            return
        }

        if (mode === "phase") {
            drawContinuousLegend(`umap-phase-grad-${div_name}`, PHASE_INTERPOLATOR, "0h", "24h", "peak time")
        } else if (mode === "qval") {
            drawContinuousLegend(
                `umap-qval-grad-${div_name}`,
                QVAL_INTERPOLATOR,
                "1",
                `1e-${QVAL_NEGLOG10_MAX}`,
                "−log₁₀ LS q",
            )
        } else if (mode === "energyPct") {
            const periodHours = selectedEnergyPeriodHours()
            drawContinuousLegend(
                `umap-energy-grad-${div_name}`,
                ENERGY_INTERPOLATOR,
                "0%",
                "100%",
                `% ${periodHours}h energy`,
            )
        }
    }
    renderColorLegend(state.colorMode)

    const hoverLabel = plotArea.append("text")
        .attr("id", `hover-label-${div_name}`)
        .attr("x", innerWidth - 4)
        .attr("y", -16)
        .attr("text-anchor", "end")
        .attr("fill", THEME.hover === "#44AA99" ? "#2c7f72" : THEME.hover) // darker teal: AA contrast on white
        .attr("font-size", 12)
        .attr("font-weight", 600)
        .style("font-family", THEME.fontMono)

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
                rafId = null
                if (!scatter.isSupported) {drawPointsCanvas(mainCtx, zx, zy, internal_high_val, internal_low_val)}
                else {scatter.updateTransform(event.transform)}
                // Clear hover during zoom; rebuild quadtree only on end (expensive)
                lastEmittedRow = null
                bus.execute_event('point_hover', null)
                drawHighlight(zx, zy, null, GeneID_select_current)
                drawAxis(xAxis, xAxisGen(zx))
                drawAxis(yAxis, yAxisGen(zy))
            })
        })
        .on("end", (event) => {
            const zx = event.transform.rescaleX(xScale)
            const zy = event.transform.rescaleY(yScale)
            currentXScale = zx
            currentYScale = zy
            if (!scatter.isSupported) {drawPointsCanvas(mainCtx, zx, zy, internal_high_val, internal_low_val)}
            else {scatter.updateTransform(event.transform)}
            lastEmittedRow = null
            bus.execute_event('point_hover', null)
            drawHighlight(zx, zy, null, GeneID_select_current)
            rebuildQuadtree(zx, zy)
            drawAxis(xAxis, xAxisGen(zx))
            drawAxis(yAxis, yAxisGen(zy))
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

    bus.subscribe_to("synth_TPM_filter", div_name, ([high_val, low_val]) => {
        if (!scatter.isSupported) {
            drawPointsCanvas(mainCtx, currentXScale, currentYScale, high_val, low_val)
            internal_high_val = high_val
            internal_low_val = low_val
            state.low = low_val; state.high = high_val
            rebuildQuadtree(currentXScale, currentYScale)
        }
        else {
            scatter.updateSelected(low_val, high_val)
            internal_high_val = high_val
            internal_low_val = low_val
            state.low = low_val; state.high = high_val
            rebuildQuadtree(currentXScale, currentYScale)
        }
    })

    bus.subscribe_to("umap_color_mode", div_name, (mode) => {
        applyColorMode(mode || "none")
    })

    bus.subscribe_to("point_select", div_name, (GeneID) => {
        drawHighlight(currentXScale, currentYScale, GeneID, GeneID)
        GeneID_select_current = GeneID
        state.selected = GeneID
    })

    if (GeneID_select_current) drawHighlight(currentXScale, currentYScale, null, GeneID_select_current)

    return { node: plotArea.node(), destroy: () => scatter.destroy() }
}