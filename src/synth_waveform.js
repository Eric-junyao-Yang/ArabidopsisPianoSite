import {interpolate_waveform} from "/src/catmullrom.js"

export class Synth_Waveform {
    constructor(canvas, onChange = () => {}) { //onChange is going to be used to pass this.points
        this.canvas = canvas
        this.ctx = canvas.getContext("2d")
        this.n_bars = 48
        this.points = Array(this.n_bars).fill(0.5)
        this.dragging = false
        this.onChange = onChange
        this.resizeCanvas()
        this.setupEvents()
        this.draw()
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
            
            ctx.lineWidth = 1
            ctx.strokeStyle = 'black'
            ctx.beginPath()
            ctx.moveTo(curCenter, 0)
            ctx.lineTo(curCenter, this.canvas.height)
            ctx.stroke()

            ctx.beginPath()
            ctx.arc(
                curCenter,
                (1 - curDotPos) * this.canvas.height,
                this.barsWidth / 2,
                0,
                2 * Math.PI
            )

            ctx.fillStyle = "rgba(51,34,136,1.0)"
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
            const x_val = (i/max_val) * this.canvas.width
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

                this.onChange(this.points)
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

        this.onChange(this.points)
        this.draw()
    }

    // Default Waves

    // Reset
    reset() {
        this.points = Array(this.n_bars).fill(0.5)
        this.onChange(this.points)
        this.draw()
    }

    // Sine
    sine() {
        for (let i=0; i < this.n_bars; i++){
            this.points[i] = (Math.sin((2*Math.PI / this.n_bars) * i) + 1 ) / 2
        }
        this.onChange(this.points)
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
        this.onChange(this.points)
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
        this.onChange(this.points)
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
        this.onChange(this.points)
        this.draw()
    }
}

