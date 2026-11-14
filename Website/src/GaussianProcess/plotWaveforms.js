import { PALETTE } from "/src/plotTheme.js"
import { catmullrom } from "/src/catmullrom.js"
import { EXP_HOURS } from "/src/GaussianProcess/GPalgo.js"

const PERIOD = 24
const EXPERIMENT_HOURS = 48
const SAMPLE_SPACING = EXP_HOURS[1] - EXP_HOURS[0] // 3 h between time points
const INTERPOLATE_COUNT = 256
const SWEEP_TIME = 500 // ms, keep in sync with sweepInc in audio_processor.js
const FADE_TIME = 5 * SWEEP_TIME // ~5 previous draws visible while fading
const AXIS_TRANSITION = 300
// Posterior draw colors; teal is reserved for the GP mean
const SAMPLE_COLORS = Object.entries(PALETTE).filter(([name]) => name !== "teal").map(([, hex]) => hex)

/**
 * Waveform panel under the synth. Two modes, matching the Circadian / All genes toggle:
 *   showAll(values)   experimental VST points + the Catmull-Rom curve the synth plays
 *   showGP(mu, std)   GP posterior mean ± 2 sd; drawSample() adds fading posterior draws
 */
export class plotWaveformsClass{
    constructor(div_name = "#Waveform"){
        this.MARGINS = {top: 20, left: 50, bottom: 30, right: 20}
        this.HEIGHT = 200
        this.WIDTH = 1000
        this.innerHeight = this.HEIGHT - this.MARGINS.top - this.MARGINS.bottom
        this.innerWidth = this.WIDTH - this.MARGINS.left - this.MARGINS.right

        this.svg = d3.select(div_name).append("svg")
            .attr("width", this.WIDTH)
            .attr("height", this.HEIGHT)

        this.plotArea = this.svg.append('g')
            .attr("transform", `translate(${this.MARGINS.left},${this.MARGINS.top})`)

        this.xScale = d3.scaleLinear()
            .domain([0, EXPERIMENT_HOURS])
            .range([0, this.innerWidth])
        this.yScale = d3.scaleLinear()
            .domain([-1, 1])
            .range([this.innerHeight, 0])

        // Light / dark shading (16 h light, 8 h dark), drawn first so data sits on top
        const bands = [
            [0, 16, PALETTE.sand, 0.28],
            [16, 24, PALETTE.indigo, 0.12],
            [24, 40, PALETTE.sand, 0.28],
            [40, 48, PALETTE.indigo, 0.12],
        ]
        this.shadeGroup = this.plotArea.append('g')
        for (const [x0, x1, color, opacity] of bands) {
            this.shadeGroup.append("rect")
                .attr("x", this.xScale(x0))
                .attr("y", 0)
                .attr("width", this.xScale(x1) - this.xScale(x0))
                .attr("height", this.innerHeight)
                .attr("fill", color)
                .attr("opacity", opacity)
        }

        this.xAxis = this.plotArea.append('g')
            .attr("transform", `translate(0,${this.innerHeight})`)
            .call(d3.axisBottom(this.xScale).tickValues(EXP_HOURS))
        this.yAxis = this.plotArea.append('g')
            .call(d3.axisLeft(this.yScale))

        this.plotArea.append("text")
            .attr("x", this.innerWidth / 2)
            .attr("y", this.innerHeight + 30)
            .attr("text-anchor", "middle")
            .text("Hours")

        // Persistent layers so updates replace paths instead of stacking
        // GP mode
        this.confIntGroup = this.plotArea.append('g').attr("class", "conf-int")
        this.muLineGroup = this.plotArea.append('g').attr("class", "mu-line")
        this.sampleLineGroup = this.plotArea.append('g').attr("class", "sample-line")
        // All genes mode
        this.interpLineGroup = this.plotArea.append('g').attr("class", "interp-line")
        this.rawDatGroup = this.plotArea.append('g').attr("class", "raw-pt")

        this.muLine = d3.line()
            .x((d) => this.xScale(d.x))
            .y((d) => this.yScale(d.mu))
        this.sampleLine = d3.line()
            .x((d) => this.xScale(d.x))
            .y((d) => this.yScale(d.y))
        this.confArea = d3.area()
            .x((d) => this.xScale(d.x))
            .y0((d) => this.yScale(d.mu + 2 * d.std))
            .y1((d) => this.yScale(d.mu - 2 * d.std))
    }

    // GP grid covers one 24 h period; repeat it across the 48 h window
    tileGrid(n, makePoint) {
        const pts = []
        for (let c = 0; c * PERIOD <= EXPERIMENT_HOURS; c++) {
            for (let i = 0; i < n; i++) {
                const x = c * PERIOD + (i * PERIOD) / n
                if (x > EXPERIMENT_HOURS) return pts
                pts.push(makePoint(x, i))
            }
        }
        return pts
    }

    // Evaluate the periodic Catmull-Rom curve through the 16 points at evenly spaced hours 0..48.
    // Points sit at EXP_HOURS (2, 5, ..., 47) and the curve wraps from 47 h back to 2 h.
    interpCurve(values) {
        const n = values.length
        return d3.range(INTERPOLATE_COUNT + 1).map((i) => {
            const x = (i * EXPERIMENT_HOURS) / INTERPOLATE_COUNT
            const pos = (((x - EXP_HOURS[0]) / SAMPLE_SPACING) % n + n) % n
            const p1 = Math.floor(pos)
            const y = catmullrom(
                values[(p1 - 1 + n) % n],
                values[p1],
                values[(p1 + 1) % n],
                values[(p1 + 2) % n],
                pos - p1,
            )
            return { x, y }
        })
    }

    setYDomain(domain) {
        this.yScale.domain(domain).nice()
        this.yAxis.transition().duration(AXIS_TRANSITION).call(d3.axisLeft(this.yScale))
    }

    clearAllMode() {
        this.rawDatGroup.selectAll("*").remove()
        this.interpLineGroup.selectAll("*").remove()
    }

    clearGPMode() {
        this.confIntGroup.selectAll("*").remove()
        this.muLineGroup.selectAll("*").remove()
        // interrupt() stops pending fades so their .remove() can't fire on a cleared layer
        this.sampleLineGroup.selectAll("*").interrupt().remove()
    }

    /** All genes mode. values: 16 VST values in EXP_HOURS order, or null for an empty plot. */
    showAll(values = null) {
        this.clearGPMode()
        this.clearAllMode()
        if (!values) {
            this.setYDomain([-1, 1])
            return
        }

        const curve = this.interpCurve(values)
        this.setYDomain(d3.extent(curve, (d) => d.y))

        this.interpLineGroup.append("path")
            .datum(curve)
            .attr("fill", "none")
            .attr("stroke", "steelblue")
            .attr("stroke-width", 1.75)
            .attr("opacity", 0.95)
            .attr("d", this.sampleLine)

        this.rawDatGroup.selectAll("circle")
            .data(EXP_HOURS.map((x, i) => ({ x, y: values[i] })))
            .join("circle")
            .attr("cx", (d) => this.xScale(d.x))
            .attr("cy", (d) => this.yScale(d.y))
            .attr("r", 6)
            .attr("fill", "steelblue")
    }

    /** Circadian mode. mu, std: GP posterior over one period, or null for an empty band. */
    showGP(mu = null, std = null) {
        this.clearAllMode()
        this.clearGPMode()
        const dat = mu && std
            ? this.tileGrid(mu.length, (x, i) => ({ x, mu: mu[i], std: std[i] }))
            : [{ x: 0, mu: 0, std: 1 }, { x: EXPERIMENT_HOURS, mu: 0, std: 1 }]

        this.setYDomain([
            d3.min(dat, (d) => d.mu - 2 * d.std),
            d3.max(dat, (d) => d.mu + 2 * d.std),
        ])

        this.confIntGroup.append("path")
            .datum(dat)
            .attr("fill", PALETTE.indigo)
            .attr("opacity", 0.12)
            .attr("stroke", "none")
            .attr("d", this.confArea)

        this.muLineGroup.append("path")
            .datum(dat)
            .attr("fill", "none")
            .attr("stroke", PALETTE.teal)
            .attr("stroke-width", 1.75)
            .attr("opacity", 0.95)
            .attr("d", this.muLine)
    }

    /** Add one posterior draw; the previous draw fades out over FADE_TIME. */
    drawSample(sample){
        const dat = this.tileGrid(sample.length, (x, i) => ({ x, y: sample[i] }))
        const color = SAMPLE_COLORS[Math.floor(Math.random() * SAMPLE_COLORS.length)]

        this.sampleLineGroup.selectAll("path.current")
            .classed("current", false)
            .transition()
            .duration(FADE_TIME)
            .ease(d3.easeLinear)
            .attr("opacity", 0)
            .remove()

        this.sampleLineGroup.append("path")
            .datum(dat)
            .attr("class", "current")
            .attr("fill", "none")
            .attr("stroke", color)
            .attr("stroke-width", 1.75)
            .attr("opacity", 0.95)
            .attr("d", this.sampleLine)
    }
}
