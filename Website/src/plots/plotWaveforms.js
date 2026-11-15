import { PALETTE, THEME } from "/src/plots/plotTheme.js"
import { EXP_HOURS } from "/src/GaussianProcess/GPalgo.js"
import { createDayNightFrame, periodicCurve, EXPERIMENT_HOURS } from "/src/plots/dayNightFrame.js"

const PERIOD = 24
const SWEEP_TIME = 50 // ms, keep in sync with SYNTH_SWEEP_SECONDS in audio_processor.js
const FADE_TIME = 5 * SWEEP_TIME // ~5 previous draws visible while fading
const RAW_COLOR = PALETTE.indigo
const GP_MEAN_COLOR = "#2c7f72"
const GP_BAND_COLOR = PALETTE.teal
const SAMPLE_COLORS = [PALETTE.rose, PALETTE.purple, PALETTE.wine, PALETTE.green]

/**
 * Waveform panel under the synth. Two modes, matching the Circadian / All genes toggle:
 *   showAll(values)   experimental VST points + the Catmull-Rom curve the synth plays
 *   showGP(mu, std)   GP posterior mean ± 2 sd; drawSample() adds fading posterior draws
 */
export class plotWaveformsClass{
    constructor(div_name = "#Waveform"){
        this.frame = createDayNightFrame(div_name, {
            ariaLabel: "Waveform of the selected gene over 48 hours",
        })
        const { chart, xScale, yScale, innerWidth, innerHeight } = this.frame

        // Persistent layers
        // GP mode
        this.confIntGroup = chart.append('g').attr("class", "conf-int")
        this.sampleLineGroup = chart.append('g').attr("class", "sample-line")
        this.muLineGroup = chart.append('g').attr("class", "mu-line") // mean above the draws
        // All genes mode
        this.interpLineGroup = chart.append('g').attr("class", "interp-line")
        this.rawDatGroup = chart.append('g').attr("class", "raw-pt")

        // Shown when no gene is selected
        this.emptyHint = chart.append("text")
            .attr("x", innerWidth / 2)
            .attr("y", innerHeight / 2)
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "middle")
            .attr("fill", THEME.muted)
            .attr("font-size", 13)

        this.muLine = d3.line()
            .x((d) => xScale(d.x))
            .y((d) => yScale(d.mu))
        this.confArea = d3.area()
            .x((d) => xScale(d.x))
            .y0((d) => yScale(d.mu + 2 * d.std))
            .y1((d) => yScale(d.mu - 2 * d.std))
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
        const { xScale, yScale, line, setYDomain } = this.frame
        this.clearGPMode()
        this.clearAllMode()
        if (!values) {
            setYDomain([-1, 1])
            this.setEmptyHint("Select a gene on the UMAP or search for one to see its waveform")
            return
        }
        this.setEmptyHint(null)

        const curve = periodicCurve(values)
        setYDomain(d3.extent(curve, (d) => d.y))

        this.interpLineGroup.append("path")
            .datum(curve)
            .attr("fill", "none")
            .attr("stroke", RAW_COLOR)
            .attr("stroke-width", 2)
            .attr("stroke-linejoin", "round")
            .attr("d", line)

        this.rawDatGroup.selectAll("circle")
            .data(EXP_HOURS.map((x, i) => ({ x, y: values[i] })))
            .join("circle")
            .attr("cx", (d) => xScale(d.x))
            .attr("cy", (d) => yScale(d.y))
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

        this.frame.setYDomain([
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
            .attr("d", this.frame.line)
    }
}
