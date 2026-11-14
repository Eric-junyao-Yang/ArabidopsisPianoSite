import { PALETTE, THEME, styleAxis, axisLabel } from "/src/plotTheme.js"
import { catmullrom } from "/src/catmullrom.js"
import { EXP_HOURS } from "/src/GaussianProcess/GPalgo.js"

const PERIOD = 24
const EXPERIMENT_HOURS = 48
const SAMPLE_SPACING = EXP_HOURS[1] - EXP_HOURS[0] // 3 h between time points
const INTERPOLATE_COUNT = 256
const SWEEP_TIME = 500 // ms, keep in sync with sweepInc in audio_processor.js
const FADE_TIME = 5 * SWEEP_TIME // ~5 previous draws visible while fading
const RAW_COLOR = PALETTE.indigo
const GP_MEAN_COLOR = "#2c7f72"
const GP_BAND_COLOR = PALETTE.teal
const SAMPLE_COLORS = [PALETTE.rose, PALETTE.purple, PALETTE.wine, PALETTE.green]
const LIGHT_BANDS = [[0, 16, "light"], [16, 24, "dark"], [24, 40, "light"], [40, 48, "dark"]]

/**
 * Waveform panel under the synth. Two modes, matching the Circadian / All genes toggle:
 *   showAll(values)   experimental VST points + the Catmull-Rom curve the synth plays
 *   showGP(mu, std)   GP posterior mean ± 2 sd; drawSample() adds fading posterior draws
 */
export class plotWaveformsClass{
    constructor(div_name = "#Waveform"){
        this.MARGINS = {top: 22, left: 56, bottom: 36, right: 16}
        this.HEIGHT = 200
        this.WIDTH = 1000
        this.innerHeight = this.HEIGHT - this.MARGINS.top - this.MARGINS.bottom
        this.innerWidth = this.WIDTH - this.MARGINS.left - this.MARGINS.right

        this.svg = d3.select(div_name).append("svg")
            .attr("viewBox", `0 0 ${this.WIDTH} ${this.HEIGHT}`)
            .attr("preserveAspectRatio", "xMidYMid meet")
            .attr("role", "img")
            .attr("aria-label", "Waveform of the selected gene over 48 hours")

        this.plotArea = this.svg.append('g')
            .attr("transform", `translate(${this.MARGINS.left},${this.MARGINS.top})`)

        this.xScale = d3.scaleLinear()
            .domain([0, EXPERIMENT_HOURS])
            .range([0, this.innerWidth])
        this.yScale = d3.scaleLinear()
            .domain([-1, 1])
            .range([this.innerHeight, 0])

        // Light / dark shading, drawn first so data sits on top
        this.shadeGroup = this.plotArea.append('g').attr("class", "light-dark")
        for (const [x0, x1, phase] of LIGHT_BANDS) {
            const isLight = phase === "light"
            this.shadeGroup.append("rect")
                .attr("x", this.xScale(x0))
                .attr("y", 0)
                .attr("width", this.xScale(x1) - this.xScale(x0))
                .attr("height", this.innerHeight)
                .attr("fill", isLight ? PALETTE.sand : PALETTE.indigo)
                .attr("opacity", isLight ? 0.2 : 0.09)
            this.shadeGroup.append("text")
                .attr("x", this.xScale((x0 + x1) / 2))
                .attr("y", -7)
                .attr("text-anchor", "middle")
                .attr("fill", THEME.muted)
                .attr("font-size", 10)
                .attr("letter-spacing", "0.08em")
                .text(phase.toUpperCase())
        }

        this.xAxis = this.plotArea.append('g')
            .attr("transform", `translate(0,${this.innerHeight})`)
            .call(d3.axisBottom(this.xScale).tickValues(EXP_HOURS).tickSizeOuter(0))
        styleAxis(this.xAxis)
        this.yAxis = this.plotArea.append('g')
            .call(d3.axisLeft(this.yScale).ticks(5).tickSizeOuter(0))
        styleAxis(this.yAxis)

        axisLabel(this.plotArea.append("text"))
            .attr("x", this.innerWidth / 2)
            .attr("y", this.innerHeight + 32)
            .text("hours (ZT)")
        axisLabel(this.plotArea.append("text"))
            .attr("transform", "rotate(-90)")
            .attr("x", -this.innerHeight / 2)
            .attr("y", -42)
            .text("expression (VST)")

        // Persistent layers
        // GP mode
        this.confIntGroup = this.plotArea.append('g').attr("class", "conf-int")
        this.sampleLineGroup = this.plotArea.append('g').attr("class", "sample-line")
        this.muLineGroup = this.plotArea.append('g').attr("class", "mu-line") // mean above the draws
        // All genes mode
        this.interpLineGroup = this.plotArea.append('g').attr("class", "interp-line")
        this.rawDatGroup = this.plotArea.append('g').attr("class", "raw-pt")

        // Shown when no gene is selected
        this.emptyHint = this.plotArea.append("text")
            .attr("x", this.innerWidth / 2)
            .attr("y", this.innerHeight / 2)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "middle")
            .attr("fill", THEME.muted)
            .attr("font-size", 13)

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

        this.yAxis.call(d3.axisLeft(this.yScale).ticks(5).tickSizeOuter(0))
        styleAxis(this.yAxis)
    }

    setEmptyHint(text) {
        this.emptyHint.text(text ?? "").attr("display", text ? null : "none")
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
            this.setEmptyHint("Select a gene on the UMAP or search for one to see its waveform")
            return
        }
        this.setEmptyHint(null)

        const curve = this.interpCurve(values)
        this.setYDomain(d3.extent(curve, (d) => d.y))

        this.interpLineGroup.append("path")
            .datum(curve)
            .attr("fill", "none")
            .attr("stroke", RAW_COLOR)
            .attr("stroke-width", 2)
            .attr("stroke-linejoin", "round")
            .attr("d", this.sampleLine)

        this.rawDatGroup.selectAll("circle")
            .data(EXP_HOURS.map((x, i) => ({ x, y: values[i] })))
            .join("circle")
            .attr("cx", (d) => this.xScale(d.x))
            .attr("cy", (d) => this.yScale(d.y))
            .attr("r", 4.5)
            .attr("fill", RAW_COLOR)
            .attr("stroke", THEME.surface)
            .attr("stroke-width", 1.5)
    }

    /** Circadian mode. mu, std: GP posterior over one period, or null for an empty band. */
    showGP(mu = null, std = null) {
        this.clearAllMode()
        this.clearGPMode()
        this.setEmptyHint(mu && std ? null : "Select a circadian gene to see its GP model and sampled waveforms")
        const dat = mu && std
            ? this.tileGrid(mu.length, (x, i) => ({ x, mu: mu[i], std: std[i] }))
            : [{ x: 0, mu: 0, std: 1 }, { x: EXPERIMENT_HOURS, mu: 0, std: 1 }]

        this.setYDomain([
            d3.min(dat, (d) => d.mu - 2 * d.std),
            d3.max(dat, (d) => d.mu + 2 * d.std),
        ])

        this.confIntGroup.append("path")
            .datum(dat)
            .attr("fill", GP_BAND_COLOR)
            .attr("opacity", 0.18)
            .attr("stroke", "none")
            .attr("d", this.confArea)

        this.muLineGroup.append("path")
            .datum(dat)
            .attr("fill", "none")
            .attr("stroke", GP_MEAN_COLOR)
            .attr("stroke-width", 2.25)
            .attr("stroke-linejoin", "round")
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
            .attr("stroke-width", 1.5)
            .attr("stroke-linejoin", "round")
            .attr("opacity", 0.95)
            .attr("d", this.sampleLine)
    }
}
