import { interpolate_waveform } from "/src/catmullrom.js"
import { PALETTE, THEME, drawAxis, axisLabel } from "/src/plotTheme.js"

function extractLdSeries(geneRow) {
    if (!geneRow) return null
    return Object.keys(geneRow)
        .filter((k) => k.startsWith("LD_ZT"))
        .map((k) => geneRow[k])
}

function drawWave({ steps = 2000, cycles = 4, amplitude = 1, shape = 0 }) {
    return Array.from({ length: steps }, (_, i) => {
        const phase = 2 * Math.PI * cycles * (i / steps)
        const sin = Math.sin(phase)
        const square = Math.sign(sin)
        const wave = (1 - shape) * sin + shape * square
        return amplitude * wave
    })
}

function plotExpressionSeries(host, series, {
    width = 650,
    height = 280,
    margin = { top: 20, right: 20, bottom: 40, left: 50 },
} = {}) {
    host.replaceChildren()
    if (!series?.length) return

    const innerWidth = width - margin.left - margin.right
    const innerHeight = height - margin.top - margin.bottom

    const svg = d3.select(host).append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("preserveAspectRatio", "xMidYMid meet")
        .attr("class", "synth-science__svg")

    const xScale = d3.scaleLinear().domain([0, 48]).range([0, innerWidth])
    const yScale = d3.scaleLinear().domain(d3.extent(series)).range([innerHeight, 0]).nice()
    const chart = svg.append("g").attr("transform", `translate(${margin.left}, ${margin.top})`)

    const shade = (x0, x1, color, opacity) => chart.append("rect")
        .attr("x", xScale(x0)).attr("y", 0)
        .attr("width", xScale(x1) - xScale(x0)).attr("height", innerHeight)
        .attr("fill", color).attr("opacity", opacity)
    shade(0, 16, PALETTE.sand, 0.28)
    shade(24, 40, PALETTE.sand, 0.28)
    shade(16, 24, PALETTE.indigo, 0.12)
    shade(40, 48, PALETTE.indigo, 0.12)

    const tickVals = d3.range(16).map((i) => 2 + 3 * i)
    drawAxis(
        chart.append("g").attr("transform", `translate(0, ${innerHeight})`),
        d3.axisBottom(xScale).tickValues(tickVals).tickSizeOuter(0)
    )
    drawAxis(chart.append("g"), d3.axisLeft(yScale).ticks(5).tickSizeOuter(0))

    axisLabel(chart.append("text")
        .attr("x", innerWidth / 2)
        .attr("y", innerHeight + 32))
        .text("Hours")

    axisLabel(chart.append("text")
        .attr("transform", "rotate(-90)")
        .attr("x", -innerHeight / 2)
        .attr("y", -36))
        .text("normalized expression")

    chart.selectAll("circle.toc")
        .data(series)
        .join("circle")
        .attr("class", "toc")
        .attr("r", 3.5)
        .attr("fill", PALETTE.rose)
        .attr("stroke", "#fff")
        .attr("stroke-width", 1.25)
        .attr("cx", (_, i) => xScale(2 + 3 * i))
        .attr("cy", (d) => yScale(d))

    let interp = interpolate_waveform(series, 2000)
    interp = interp
        .map((value, i) => ({ pos: i * (16 / 2000), value }))
        .filter((d) => d.pos <= 15)

    const lineGen = d3.line()
        .x((d) => xScale(2 + 3 * d.pos))
        .y((d) => yScale(d.value))
        .curve(d3.curveLinear)

    chart.append("path")
        .datum(interp)
        .attr("fill", "none")
        .attr("stroke", PALETTE.rose)
        .attr("stroke-width", 2)
        .attr("stroke-linejoin", "round")
        .attr("d", lineGen)

    chart.append("text")
        .attr("x", innerWidth - 4)
        .attr("y", 14)
        .attr("text-anchor", "end")
        .attr("font-size", 12)
        .attr("font-weight", 600)
        .attr("fill", PALETTE.rose)
        .text("TOC1")
}

function makeWavePlot(host, controller, { varyingParam, playSoundBtn = false, myName = null, title = null }) {
    host.replaceChildren()

    const width = 220
    const height = playSoundBtn ? 250 : 210
    const margin = { top: 36, right: 12, bottom: playSoundBtn ? 52 : 28, left: 32 }
    const innerWidth = width - margin.left - margin.right
    const innerHeight = height - margin.top - margin.bottom

    const svg = d3.select(host).append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("preserveAspectRatio", "xMidYMid meet")
        .attr("class", "synth-science__svg")

    const xScale = d3.scaleLinear().domain([0, 2000]).range([0, innerWidth])
    const yScale = d3.scaleLinear().domain([-1, 1]).range([innerHeight, 0])
    const chart = svg.append("g").attr("transform", `translate(${margin.left}, ${margin.top})`)

    drawAxis(
        chart.append("g").attr("transform", `translate(0, ${innerHeight})`),
        d3.axisBottom(xScale).ticks(4).tickSizeOuter(0)
    )
    drawAxis(chart.append("g"), d3.axisLeft(yScale).ticks(4).tickSizeOuter(0))

    if (title) {
        chart.append("text")
            .attr("x", innerWidth / 2)
            .attr("y", -14)
            .attr("text-anchor", "middle")
            .attr("font-size", 13)
            .attr("font-weight", 600)
            .attr("fill", THEME.ink)
            .text(title)
    }

    let resetBtn = null
    if (playSoundBtn) {
        const button = chart.append("g")
            .attr("class", "synth-science__play")
            .attr("transform", `translate(${innerWidth / 2}, ${innerHeight + 34})`)
            .style("cursor", "pointer")

        button.append("rect")
            .attr("x", -48)
            .attr("y", -14)
            .attr("width", 96)
            .attr("height", 28)
            .attr("rx", 8)
            .attr("fill", "#fff")
            .attr("stroke", PALETTE.indigo)
            .attr("stroke-width", 1.5)

        button.append("rect")
            .attr("class", "progress-bar")
            .attr("x", -48)
            .attr("y", -14)
            .attr("width", 0)
            .attr("height", 28)
            .attr("rx", 8)
            .attr("fill", PALETTE.sky)
            .attr("opacity", 0.85)

        button.append("text")
            .attr("class", "text")
            .attr("text-anchor", "middle")
            .attr("dominant-baseline", "middle")
            .attr("font-size", 12)
            .attr("font-weight", 600)
            .attr("fill", PALETTE.indigo)
            .style("pointer-events", "none")
            .text("Play sound")

        const progress = button.select(".progress-bar")
        const text = button.select(".text")
        resetBtn = () => {
            progress.interrupt().attr("width", 0)
            text.text("Play sound")
        }

        button.on("click", async (event) => {
            event.stopPropagation()
            if (controller.soundFocus === myName) {
                controller.stopSound()
                return
            }
            await controller.playSound(myName, resetBtn)
            progress.interrupt().attr("width", 0)
                .transition()
                .duration(4000)
                .ease(d3.easeLinear)
                .attr("width", 96)
                .on("end", () => {
                    if (controller.soundFocus === myName) controller.stopSound()
                })
            text.text("Stop")
        })
    }

    const lineGen = d3.line()
        .x((_, i) => xScale(i))
        .y((d) => yScale(d))
        .curve(d3.curveLinear)

    const path = chart.append("path")
        .attr("fill", "none")
        .attr("stroke", PALETTE.indigo)
        .attr("stroke-width", 2)
        .attr("stroke-linejoin", "round")

    let t = 0
    function animate() {
        if (!host.isConnected) return
        t += 0.05
        const params = { steps: 2000, cycles: 3, amplitude: 1, shape: 0 }
        if (varyingParam === "amplitude") params.amplitude = 0.6 + 0.4 * Math.sin(t)
        if (varyingParam === "cycles") params.cycles = 3 + Math.sin(t)
        if (varyingParam === "shape") params.shape = Math.abs(Math.sin(t * 0.5))

        if (controller.bus && controller.soundFocus === myName) {
            controller.bus.execute_event("updateParams", params)
        }

        path.datum(drawWave(params)).attr("d", lineGen)
        requestAnimationFrame(animate)
    }
    animate()
}

/**
 * Mount expression + interactive waveform demos into #Synth_Science_div.
 * Audio still uses the shared bus events `updateParams` / `stopSlideSound`.
 */
export function mountSynthScienceDiv({
    root = document.getElementById("Synth_Science_div"),
    geneRow = null,
    bus = null,
    initAudio = null,
} = {}) {
    if (!root) return null

    const controller = {
        bus,
        soundFocus: null,
        soundTimer: null,
        activeResetBtn: null,
        internalInitAudio: initAudio,

        async playSound(myName, resetBtn) {
            this.stopSound()
            if (this.internalInitAudio) await this.internalInitAudio()
            this.soundFocus = myName
            this.activeResetBtn = resetBtn
            clearTimeout(this.soundTimer)
            this.soundTimer = setTimeout(() => this.stopSound(), 4000)
        },

        stopSound() {
            clearTimeout(this.soundTimer)
            const resetBtn = this.activeResetBtn
            this.activeResetBtn = null
            if (resetBtn) resetBtn()
            this.soundFocus = null
            this.soundTimer = null
            this.bus?.execute_event("stopSlideSound", null)
        },
    }

    const series = extractLdSeries(geneRow)
    const dataHost = root.querySelector("#Synth_Science_data_plot")
    if (dataHost) plotExpressionSeries(dataHost, series)

    const waveSpecs = [
        { sel: "#amp_plot", varyingParam: "amplitude", myName: "Amplitude", title: "Amplitude" },
        { sel: "#freq_plot", varyingParam: "cycles", myName: "Frequency", title: "Frequency" },
        { sel: "#shape_plot", varyingParam: "shape", myName: "Shape", title: "Shape" },
    ]
    for (const spec of waveSpecs) {
        const host = root.querySelector(spec.sel)
        if (!host) continue
        makeWavePlot(host, controller, {
            varyingParam: spec.varyingParam,
            playSoundBtn: true,
            myName: spec.myName,
            title: spec.title,
        })
    }

    return controller
}
