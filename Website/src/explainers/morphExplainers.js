import { PALETTE, drawAxis, axisLabel, plotTitle } from "../plots/plotTheme.js"

const PLAY_MS = 4000 // how long a morph explainer plays per press

function morphSamples({ steps = 2000, cycles = 4, amplitude = 1, shape = 0 }) {
    return Array.from({ length: steps }, (_, i) => {
        const phase = 2 * Math.PI * cycles * (i / steps)
        const sin = Math.sin(phase)
        const square = Math.sign(sin)
        const wave = (1 - shape) * sin + shape * square
        return amplitude * wave
    })
}

function plotMorphWave(host, voiceOwner, { varyingParam, playSoundBtn = false, name = null, title = null }) {
    host.replaceChildren()

    const width = 220
    const height = playSoundBtn ? 280 : 210
    const margin = { top: 32, right: 12, bottom: playSoundBtn ? 78 : 28, left: 40 }
    const innerWidth = width - margin.left - margin.right
    const innerHeight = height - margin.top - margin.bottom

    const svg = d3.select(host).append("svg")
        .attr("viewBox", `0 0 ${width} ${height}`)
        .attr("preserveAspectRatio", "xMidYMid meet")
        .attr("class", "explainer__svg")

    const xScale = d3.scaleLinear().domain([0, 2000]).range([0, innerWidth])
    const yScale = d3.scaleLinear().domain([-1, 1]).range([innerHeight, 0])
    const chart = svg.append("g").attr("transform", `translate(${margin.left}, ${margin.top})`)

    drawAxis(
        chart.append("g").attr("transform", `translate(0, ${innerHeight})`),
        d3.axisBottom(xScale).ticks(4).tickSizeOuter(0)
    )
    drawAxis(chart.append("g"), d3.axisLeft(yScale).ticks(4).tickSizeOuter(0))

    axisLabel(chart.append("text")
        .attr("x", innerWidth / 2)
        .attr("y", innerHeight + 35))
        .text("time")

    axisLabel(chart.append("text")
        .attr("transform", "rotate(-90)")
        .attr("x", -innerHeight / 2)
        .attr("y", -30))
        .text("amplitude")

    if (title) {
        plotTitle(chart.append("text")
            .attr("x", innerWidth / 2)
            .attr("y", -14))
            .attr("text-anchor", "middle")
            .text(title)
    }

    // The wave on screen right now; the sound follows it every frame while this plot owns the voice
    let params = { steps: 2000, cycles: 3, amplitude: 1, shape: 0 }
    const morphMessage = () => ({
        type: "morph",
        amplitude: params.amplitude,
        shape: params.shape,
        cycles: params.cycles,
    })

    let resetBtn = null
    if (playSoundBtn) {
        const button = chart.append("g")
            .attr("class", "explainer__play")
            .attr("transform", `translate(${innerWidth / 2}, ${innerHeight + 62})`)
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

        button.on("click", (event) => {
            event.stopPropagation()
            if (voiceOwner.owner === name) {
                voiceOwner.release(name)
                return
            }
            voiceOwner.claim(name, resetBtn, morphMessage)
            // Plays for PLAY_MS; the filling bar shows how long is left
            progress.interrupt().attr("width", 0)
                .transition()
                .duration(PLAY_MS)
                .ease(d3.easeLinear)
                .attr("width", 96)
                .on("end", () => voiceOwner.release(name))
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
        params = { steps: 2000, cycles: 3, amplitude: 1, shape: 0 }
        if (varyingParam === "amplitude") params.amplitude = 0.6 + 0.4 * Math.sin(t)
        if (varyingParam === "cycles") params.cycles = 3 + Math.sin(t)
        if (varyingParam === "shape") params.shape = Math.abs(Math.sin(t * 0.5))

        voiceOwner.send(name, morphMessage())

        path.datum(morphSamples(params)).attr("d", lineGen)
        requestAnimationFrame(animate)
    }
    animate()
}

/** Mount the amplitude / frequency / shape explainers into root; they play through voiceOwner. */
export function mountMorphExplainers(root, voiceOwner) {
    if (!root) return

    const morphSpecs = [
        { sel: "#Morph_amplitude", varyingParam: "amplitude", name: "Amplitude", title: "Amplitude" },
        { sel: "#Morph_frequency", varyingParam: "cycles", name: "Frequency", title: "Frequency" },
        { sel: "#Morph_shape", varyingParam: "shape", name: "Shape", title: "Shape" },
    ]
    for (const spec of morphSpecs) {
        const host = root.querySelector(spec.sel)
        if (!host) continue
        plotMorphWave(host, voiceOwner, {
            varyingParam: spec.varyingParam,
            playSoundBtn: true,
            name: spec.name,
            title: spec.title,
        })
    }
}
