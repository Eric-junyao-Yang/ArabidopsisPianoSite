import { THEME, hexToRgb01 } from "/src/plotTheme.js"

// Point RGB is set by color mode; selected/inactive = TPM filter (orthogonal).
const INACTIVE_RGB = hexToRgb01(THEME.pointInactive).map((v) => v.toFixed(4)).join(", ")
const OUTLINE_RGB = hexToRgb01(THEME.ink).map((v) => v.toFixed(4)).join(", ")
export const ACTIVE_ALPHA = 0.55
export const INACTIVE_ALPHA = 0.4
export const OUTLINE_ALPHA = 0.7
export const POINT_RADIUS_PX = 4
export const POINT_OUTLINE_PX = 1
// Fill disk as a fraction of the drawn quad (outline sits in the outer ring).
const FILL_RADIUS_FRAC = POINT_RADIUS_PX / (POINT_RADIUS_PX + POINT_OUTLINE_PX)

export class ScatterGL {
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
                // Outline only on TPM-selected points; filtered-out dots stay borderless.
                float strokeA = vSelected > 0.5
                    ? ${OUTLINE_ALPHA.toFixed(2)} * strokeMask
                    : 0.0;

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
