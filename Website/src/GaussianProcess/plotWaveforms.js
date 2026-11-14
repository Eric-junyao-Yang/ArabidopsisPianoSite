import { PALETTE } from "/src/plotTheme.js"
import { interpolate_waveform } from "/src/catmullrom.js"
import { VSTlookup_to_arr } from "/src/GaussianProcess/GPalgo.js"

export class plotWaveformsClass{
    constructor(){
        this.current_display_GeneID = null
        this.PERIOD = 24
        this.EXP_HOURS = Array.from({ length: 16 }, (_, i) => 2 + 3 * i)
        this.INTERPOLATE_COUNT = 256
        this.EXPERIMENT_HOURS = 48
        this.SWEEP_TIME = 500 // same as in audio_processor
        this.FADE_TIME = 5 * this.SWEEP_TIME // ~5 previous draws visible while fading
        this.MARGINS = {top: 20, left: 50, bottom: 30, right: 20}
        this.HEIGHT = 200
        this.WIDTH = 1000
        this.innerHeight = this.HEIGHT - this.MARGINS.top - this.MARGINS.bottom
        this.innerWidth = this.WIDTH - this.MARGINS.left - this.MARGINS.right

        this.svg = d3.select("#Waveform").append("svg")
            .attr("width", this.WIDTH)
            .attr("height", this.HEIGHT)

        this.plotArea = this.svg.append('g')
            .attr("transform", `translate(${this.MARGINS.left},${this.MARGINS.top})`)

        this.xScale = d3.scaleLinear()
            .domain([0, this.EXPERIMENT_HOURS])
            .range([0, this.innerWidth])
        this.yScale = d3.scaleLinear()
            .domain([-1, 1])
            .range([this.innerHeight, 0])

        this.xAxis = this.plotArea.append('g')
            .attr("transform", `translate(0,${this.innerHeight})`)
            .call(d3.axisBottom(this.xScale).tickValues(this.EXP_HOURS))
        this.yAxis = this.plotArea.append('g')
            .call(d3.axisLeft(this.yScale))

        this.plotArea.append("text")
            // .attr("transform", "rotate(-90)")
            .attr("x", this.innerWidth/2)
            .attr("y", this.innerHeight + 30)
            .attr("text-anchor", "middle")
            .text("Hours")

        // Color the night light cycle
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

        // Persistent layers so updates replace paths instead of stacking
        this.confIntGroup = this.plotArea.append('g').attr("class", "conf-int")
        this.muLineGroup = this.plotArea.append('g').attr("class", "mu-line")
        this.sampleLineGroup = this.plotArea.append('g').attr("class", "sample-line")

        this.rawDatGroup = this.plotArea.append('g').attr("class", "raw-pt")
        this.interpLineGroup = this.plotArea.append('g').attr("class", "interp-line")

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

    tileSeries(mu, std, period = this.PERIOD, hours = this.EXPERIMENT_HOURS) {
        const n = mu.length
        const pts = []
        const maxCycles = Math.ceil(hours / period) + 1
        for (let c = 0; c < maxCycles; c++) {
            for (let i = 0; i < n; i++) {
                const x = c * period + (i * period) / n
                if (x > hours) return pts
                pts.push({ x, mu: mu[i], std: std[i] })
            }
        }
        return pts
    }

    tileSample(sample, period = this.PERIOD, hours = this.EXPERIMENT_HOURS) {
        const n = sample.length
        const pts = []
        const maxCycles = Math.ceil(hours / period) + 1
        for (let c = 0; c < maxCycles; c++) {
            for (let i = 0; i < n; i++) {
                const x = c * period + (i * period) / n
                if (x > hours) return pts
                pts.push({ x, y: sample[i]})
            }
        }
        return pts        
    }

    tileInterp(sample, period = this.PERIOD, hours = this.EXPERIMENT_HOURS) {
        const sample_len = sample.length
        const shift = (sample_len / hours) * -2
        const shifted_sample = [...sample.slice(shift), ...sample.slice(0, shift)]
        return shifted_sample.map((v,i) => ({
            x: (hours / sample_len) * i,
            y: v
        }))
    }

    renderGPData(dat){
        const bandLo = dat.map((d) => d.mu - 2 * d.std)
        const bandHi = dat.map((d) => d.mu + 2 * d.std)
        this.yScale.domain([d3.min(bandLo), d3.max(bandHi)]).nice()
        this.yAxis.transition().duration(300).call(d3.axisLeft(this.yScale))

        this.confIntGroup.selectAll("path")
            .data([dat])
            .join("path")
            .attr("fill", PALETTE.indigo)
            .attr("opacity", 0.12)
            .attr("stroke", "none")
            .attr("d", this.confArea)

        this.muLineGroup.selectAll("path")
            .data([dat])
            .join("path")
            .attr("fill", "none")
            .attr("stroke", PALETTE.teal)
            .attr("stroke-width", 1.75)
            .attr("opacity", 0.95)
            .attr("d", this.muLine)
    }

    updateGeneID(GeneID, VSTresult = null, mu = null, std = null){
        if (GeneID === this.current_display_GeneID) return
        this.current_display_GeneID = GeneID
        if (mu && std | !VSTresult) {
            const dat = this.tileSeries(mu, std)
            this.renderGPData(dat)
        } else if (VSTresult | (!mu && !std)) {
            const raw_dat = VSTlookup_to_arr(VSTresult)
            const interp_dat = interpolate_waveform(raw_dat, this.INTERPOLATE_COUNT)
            this.renderAllData(raw_dat, interp_dat)
        }

    }

    drawSample(sample){
        const dat = this.tileSample(sample)
        // random color picker:
        const colors = Object.values(PALETTE).filter(v => v !== "teal") //used for mean
        const randomColor = colors[Math.floor(Math.random() * colors.length)]
        // Previous draw fades out instead of being replaced; removed once invisible
        this.sampleLineGroup.selectAll("path.current")
            .classed("current", false)
            .transition()
            .duration(this.FADE_TIME)
            .ease(d3.easeLinear)
            .attr("opacity", 0)
            .remove()

        this.sampleLineGroup.append("path")
            .datum(dat)
            .attr("class", "current")
            .attr("fill", "none")
            .attr("stroke", randomColor)
            .attr("stroke-width", 1.75)
            .attr("opacity", 0.95)
            .attr("d", this.sampleLine)
    }

    renderEmpty_GP(){
        this.current_display_GeneID = null
        const dat = this.xScale.domain().map((x) => ({
            x,
            mu: 0,
            std: 1
        }))

        this.renderGPData(dat)
    }

    clearAll(){
        this.muLineGroup.selectAll("path").remove()
        this.sampleLineGroup.selectAll("path").remove()
        this.confIntGroup.selectAll("path").remove()
        this.rawDatGroup.selectAll("circle").remove()
        this.interpLineGroup.selectAll("path").remove()
    }

    renderAllData(raw_dat, interp_dat){
        this.clearAll()
        this.yScale.domain(d3.extent(interp_dat)).nice()
        this.yAxis.transition().duration(300).call(d3.axisLeft(this.yScale))

        const raw_tiled = this.EXP_HOURS.map((v, i) => ({
            x: v,
            y: raw_dat[i]
        }))

        const interp_tiled = this.tileInterp(interp_dat)
        this.rawDatGroup.selectAll("circle")
            .data(raw_tiled)
            .join("circle")
            .attr("cx", d => this.xScale(d.x))
            .attr("cy", d => this.yScale(d.y))
            .attr("r", 6)
            .attr("fill", "steelblue")
        
        this.interpLineGroup.selectAll("path")
            .data([interp_tiled])
            .join("path")
            .attr("fill", "none")
            .attr("stroke", "steelblue")
            .attr("stroke-width", 1.75)
            .attr("opacity", 0.95)
            .attr("d", this.sampleLine)
    }

    renderEmpty_All(){
        this.clearAll()
        this.yScale.domain([-1,1]).nice()
        this.yAxis.transition().duration(300).call(d3.axisLeft(this.yScale))
    }
}
