import { interpolate_waveform, maxAbsScaling, ldTimepoints } from "/src/catmullrom.js"
import { PALETTE, THEME, withAlpha } from "/src/plotTheme.js"

export class Synth_Waveform {
    constructor(canvas, bus, count_arr) { 
        this.canvas = canvas
        this.ctx = canvas.getContext("2d")
        this.dpr = window.devicePixelRatio || 1
        this.w = canvas.clientWidth
        this.h = canvas.clientHeight
        this.n_bars = 48
        this.points = Array(this.n_bars).fill(0.5)
        this.dragging = false
        this.count_arr = count_arr

        this.bus = bus
        // suscribe to bus
        this.bus.subscribe_to("point_select", null, (GeneID) => {
            if (!GeneID){
                this.reset()
                return
            }
            this.updatePointsWithGeneID(GeneID)
            this.bus_execute(this.points)
            this.draw()
        })
        this.GeneID_Lookup = new Map(count_arr.map(r => [r.GeneID, r]))

        this.resizeCanvas()
        this.setupEvents()
        this.draw()

    }

    bus_execute(points){
        this.bus.execute_event("synth_waveform_changed", this.points)
    }

    // Geometry is in CSS pixels (this.w / this.h); the backing store is scaled by devicePixelRatio
    get barsWidth() {
        return this.w / this.n_bars
    }

    get barsCenter() {
        return this.w / (this.n_bars * 2)
    }

    draw_waveform(ctx) {
        const w = this.w
        const h = this.h
        // zero line
        ctx.save()
        ctx.setLineDash([4, 4])
        ctx.lineWidth = 1
        ctx.strokeStyle = withAlpha(THEME.muted, 0.35)
        ctx.beginPath()
        ctx.moveTo(0, h / 2)
        ctx.lineTo(w, h / 2)
        ctx.stroke()
        ctx.restore()

        const dotR = Math.max(2.5, Math.min(this.barsWidth * 0.3, 5))
        for (let i = 0; i < this.n_bars; i++) {
            const measured = (i - 1) % 3 == 0 // positions that correspond to real 3h measurements
            const x = i * this.barsWidth + this.barsCenter
            const y = (1 - this.points[i]) * h

            // faint column guide (stronger at measured positions)
            ctx.lineWidth = 1
            ctx.strokeStyle = measured ? withAlpha(THEME.axis, 0.9) : withAlpha(THEME.grid, 0.9)
            ctx.beginPath()
            ctx.moveTo(x, 0)
            ctx.lineTo(x, h)
            ctx.stroke()

            // stem from the zero line to the value
            ctx.lineWidth = 1.5
            ctx.strokeStyle = withAlpha(PALETTE.indigo, 0.28)
            ctx.beginPath()
            ctx.moveTo(x, h / 2)
            ctx.lineTo(x, y)
            ctx.stroke()

            ctx.beginPath()
            ctx.arc(x, y, measured ? dotR * 1.25 : dotR, 0, 2 * Math.PI)
            ctx.fillStyle = measured ? PALETTE.rose : withAlpha(PALETTE.indigo, 0.55)
            ctx.fill()
            if (measured) {
                ctx.lineWidth = 1.5
                ctx.strokeStyle = "#ffffff"
                ctx.stroke()
            }
        }
    }

    draw_interpolation(ctx){
        // Raw Catmull through control points (edit preview). Audio uses
        // interpolate → maxAbs via toUnipolarWavetable — live maxAbs here would
        // rescale the curve on every drag and pull it off the dots.
        const interpolation_array = interpolate_waveform(this.points, 256)
        const max_val = interpolation_array.length
        ctx.lineWidth = 2.5
        ctx.lineJoin = "round"
        ctx.lineCap = "round"
        ctx.strokeStyle = PALETTE.indigo
        ctx.beginPath()
        for (let i=0;i<max_val;i++){
            const x_val = (i/max_val) * this.w + this.barsWidth / 2
            if (i == 0) {
                ctx.moveTo(x_val, (1 - interpolation_array[i]) * this.h)
            } else {
                ctx.lineTo(x_val, (1 - interpolation_array[i]) * this.h)
            }
        }
        ctx.stroke()
    }

    draw() {
        const ctx = this.ctx
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0)
        ctx.clearRect(0, 0, this.w, this.h)
        this.draw_waveform(ctx)
        this.draw_interpolation(ctx)
    }

    scaleToPlot(input_array){
        // maxAbsScaling → bipolar [-1, 1]; plot / control points use [0, 1]
        return input_array.map((v) => (v + 1) / 2)
    }

    updatePointsWithGeneID(GeneID) {
        const cur_row = this.GeneID_Lookup.get(GeneID)
        if (!cur_row) return
        const cur_values = ldTimepoints(cur_row)
        const interpolated_values = this.scaleToPlot(
            maxAbsScaling(interpolate_waveform(cur_values, 48))
        )
        // Rotate right by 1 for visual alignment with the bar grid
        const n = interpolated_values.length
        this.points = interpolated_values.map((_, i) => interpolated_values[(i - 1 + n) % n])
    }

    setupEvents() {
        const paintAtClient = (clientX, clientY) => {
            const rect = this.canvas.getBoundingClientRect()
            const x = clientX - rect.left
            const y = clientY - rect.top
            const index = Math.floor(x / this.barsWidth)
            if (index < 0 || index >= this.n_bars) return

            this.points[index] = Math.min(
                1,
                Math.max(0, (this.h - y) / this.h)
            )
            this.bus_execute(this.points)
            this.draw()
        }

        this.canvas.addEventListener("pointerdown", (e) => {
            this.dragging = true
            this.canvas.setPointerCapture?.(e.pointerId)
            paintAtClient(e.clientX, e.clientY)
        })

        this.canvas.addEventListener("pointermove", (e) => {
            if (!this.dragging) return
            paintAtClient(e.clientX, e.clientY)
        })

        const endDrag = () => {
            this.dragging = false
        }
        this.canvas.addEventListener("pointerup", endDrag)
        this.canvas.addEventListener("pointercancel", endDrag)
        this.canvas.addEventListener("lostpointercapture", endDrag)

        // Track the element itself (covers window resize, rotation and layout changes)
        let last = ""
        new ResizeObserver(() => {
            const key = `${this.canvas.clientWidth}x${this.canvas.clientHeight}`
            if (key === last) return
            last = key
            this.resizeCanvas()
        }).observe(this.canvas)
    }

    resizeCanvas() {
        this.dpr = window.devicePixelRatio || 1
        this.w = this.canvas.clientWidth
        this.h = this.canvas.clientHeight
        this.canvas.width = Math.round(this.w * this.dpr)
        this.canvas.height = Math.round(this.h * this.dpr)

        this.bus_execute(this.points)
        this.draw()
    }

    // Default Waves

    // Reset
    reset() {
        this.points = Array(this.n_bars).fill(0.5)
        this.bus_execute(this.points)
        this.draw()
    }

    // Sine
    sine() {
        for (let i=0; i < this.n_bars; i++){
            this.points[i] = (Math.sin((2*Math.PI / this.n_bars) * i) + 1 ) / 2
        }
        this.bus_execute(this.points)
        this.draw()
    }

    // Square
    square() {
        for (let i=0; i < this.n_bars; i ++){
            if (i <= this.n_bars / 2){
                this.points[i] = 1
            }

            else {
                this.points[i] = 0
            }
        }
        this.bus_execute(this.points)
        this.draw()
    }

    // Saw
    saw() {
        for (let i=0; i < this.n_bars; i++){
            if (i <= 1/2 * this.n_bars){
                this.points[i] = (1/this.n_bars) * i + 0.5
            }
            else {
                this.points[i] = (1/this.n_bars) * i - 0.5
            }
        }
        this.bus_execute(this.points)
        this.draw()
    }

    // Triangle
    triangle() {
        for (let i=0; i<this.n_bars; i++){
            if (i <= (1/4) * this.n_bars){
                this.points[i] = 8/(4*this.n_bars) * i + 0.5
            }
            else if (i <= (3/4) * this.n_bars){
                this.points[i] = -2 / this.n_bars * i + 1.5
            }
            else {
                this.points[i] = 8/(4*this.n_bars) * i - 1.5
            }
        }
        this.bus_execute(this.points)
        this.draw()
    }
}
