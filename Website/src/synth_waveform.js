import { interpolate_waveform, maxAbsScaling } from "/src/catmullrom.js"

export class Synth_Waveform {
    constructor(canvas, bus, count_arr) { 
        this.canvas = canvas
        this.ctx = canvas.getContext("2d")
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
        this.GeneID_Lookup = new Map(count_arr.map(r => [r.id, r]))

        this.resizeCanvas()
        this.setupEvents()
        this.draw()

    }

    bus_execute(points){
        this.bus.execute_event("synth_waveform_changed", this.points)
    }

    get barsWidth() {
        return this.canvas.width / this.n_bars
    }

    get barsCenter() {
        return this.canvas.width / (this.n_bars * 2)
    }

    draw_waveform(ctx) {
        for (let i = 0; i < this.n_bars; i++) {

            const curCenter =
                i * this.barsWidth + this.barsCenter

            const curDotPos = this.points[i]
            
            ctx.lineWidth = (i-1) % 3 == 0? 3:1
            ctx.strokeStyle = 'black'
            ctx.beginPath()
            ctx.moveTo(curCenter, 0)
            ctx.lineTo(curCenter, this.canvas.height)
            ctx.stroke()

            ctx.beginPath()
            ctx.lineWidth = 1
            ctx.arc(
                curCenter,
                (1 - curDotPos) * this.canvas.height,
                this.barsWidth / 2,
                0,
                2 * Math.PI
            )
            ctx.fillStyle = (i-1) % 3 == 0? "rgba(136,34,85,1.0)":"rgba(51,34,136,1.0)" 
            ctx.fill()
            ctx.stroke()
        }
    }

    draw_interpolation(ctx){
        const interpolation_array = interpolate_waveform(this.points, 256)
        const max_val = interpolation_array.length
        ctx.lineWidth = 2
        ctx.strokeStyle = 'rgba(204,102,119,1.0)'
        ctx.beginPath()
        for (let i=0;i<max_val;i++){
            const x_val = (i/max_val) * this.canvas.width + this.barsWidth / 2
            if (i == 0) {
                ctx.moveTo(x_val, (1 - interpolation_array[i]) * this.canvas.height)
            } else {
                ctx.lineTo(x_val, (1 - interpolation_array[i]) * this.canvas.height)
            }
        }
        ctx.stroke()
    }

    draw() {
        const ctx = this.ctx
        ctx.clearRect(
            0,
            0,
            this.canvas.width,
            this.canvas.height
        )
        this.draw_waveform(ctx)
        this.draw_interpolation(ctx)
    }

    scaleToPlot(input_array){
        // interpolate_waveform returns values scaled to -1 to 1
        // plot accepts values between 0 to 1
        return input_array.map((v,i) => (v + 1) / 2)
    }

    updatePointsWithGeneID(GeneID){
        // load 16 data points
        const cur_row = this.GeneID_Lookup.get(GeneID)
        const cur_values = Object.values(cur_row).slice(0, 16)
        // const norm_values = new Array(cur_values.length)
        // cur_values.map((val, idx) => {
        //     norm_values[idx] = (val + 1) / 2
        // })
        const interpolated_values = this.scaleToPlot(maxAbsScaling(interpolate_waveform(cur_values, 48)))

        // For visual appeal, rotate everything right by 1 with wrap around
        const n = interpolated_values.length
        this.points = interpolated_values.map((_, i) => interpolated_values[(i - 1 + n) % n])
    }

    setupEvents() {

        this.canvas.addEventListener("mousedown", () => {
            this.dragging = true
        })

        window.addEventListener("mouseup", () => {
            this.dragging = false
        })

        this.canvas.addEventListener(
            "mousemove",
            (e) => {

                if (!this.dragging) return

                const index =
                    Math.floor(
                        e.offsetX / this.barsWidth
                    )

                if (
                    index < 0 ||
                    index >= this.n_bars
                ) return

                this.points[index] =
                    (this.canvas.height - e.offsetY) / this.canvas.height

                this.bus_execute(this.points)
                this.draw()
            }
        )

        window.addEventListener(
            "resize",
            () => this.resizeCanvas()
        )
    }

    resizeCanvas() {
        this.canvas.width =
            this.canvas.clientWidth

        this.canvas.height =
            this.canvas.clientHeight

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
