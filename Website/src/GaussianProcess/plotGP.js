import { PALETTE } from "/src/plotTheme.js"

export class plotGPClass{
    constructor(){
        this.current_display_GeneID = null
        this.PERIOD = 24
        this.EXP_HOURS = Array.from({ length: 16 }, (_, i) => 2 + 3 * i)
        this.EXPERIMENT_HOURS = 48
        this.MARGINS = {top: 20, left: 50, bottom: 20, right: 20}
        this.HEIGHT = 200
        this.WIDTH = 1000
        this.innerHeight = this.HEIGHT - this.MARGINS.top - this.MARGINS.bottom
        this.innerWidth = this.WIDTH - this.MARGINS.left - this.MARGINS.right

        this.svg = d3.select("#GP_Waveform").append("svg")
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

        // Persistent layers so updates replace paths instead of stacking
        this.confIntGroup = this.plotArea.append('g').attr("class", "conf-int")
        this.muLineGroup = this.plotArea.append('g').attr("class", "mu-line")

        this.muLine = d3.line()
            .x((d) => this.xScale(d.x))
            .y((d) => this.yScale(d.mu))
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

    updateGeneID(GeneID, mu, std){
        if (GeneID === this.current_display_GeneID) return
        this.current_display_GeneID = GeneID

        const dat = this.tileSeries(mu, std)

        const bandLo = dat.map((d) => d.mu - 2 * d.std)
        const bandHi = dat.map((d) => d.mu + 2 * d.std)
        this.yScale.domain([d3.min(bandLo), d3.max(bandHi)]).nice()
        this.yAxis.call(d3.axisLeft(this.yScale))

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

    drawSample()
}
