import { PALETTE, THEME, axisLabel, plotTitle } from "/src/plotTheme.js"
import { ldTimepoints } from "/src/catmullrom.js"
export function plotGPWave(width, height, div_name = "#StepSeqGPPlot"){
    const host = document.querySelector(div_name)
    if (host?.clientWidth) {
        width = Math.max(240, Math.floor(host.clientWidth))
        height = Math.max(220, Math.min(height, Math.round(width * 0.72)))
    }
    const margin = {top: 44, right: 20, bot: 46, left: 54}
    const innerWidth = width - margin.left - margin.right
    const innerHeight = height - margin.top - margin.bot
    const EXPERIMENT_HOURS = 48
    // LD sampling times: every 3 h starting at hour 2 (same as gene_plots / intro figure)
    const VST_TIMES = d3.range(16).map((i) => 2 + 3 * i)

    const div = d3.select(div_name)
        .style("height", null) // let the svg define the height (avoids 1-2px scrollbars from borders)
        .style("position", "relative")

    div.selectAll('svg').remove()

    const svg = div.append('svg')
        .attr("width", width)
        .attr("height", height)
        .style("position", "relative")
        .style("display", "block")

    const plotArea = svg.append('g')
        .attr('transform', `translate(${margin.left}, ${margin.top})`)

    const xScale = d3.scaleLinear().range([0, innerWidth])
    const yScale = d3.scaleLinear().range([innerHeight, 0])

    // ---------- Set up Axis and labels -----------
    const shadeGroup = plotArea.append("g").attr("class", "day-night-shade")

    const xAxisG = plotArea.append('g')
        .attr("class", "x-axis")
        .attr("transform", `translate(0, ${innerHeight})`)
    
    const yAxisG = plotArea.append('g')
        .attr("class", "y-axis")
    
    axisLabel(plotArea.append("text")
        .attr("x", innerWidth / 2)
        .attr("y", innerHeight + 36))
        .text("Hours")
    
    axisLabel(plotArea.append("text")
        .attr("transform", "rotate(-90)")
        .attr("x", -innerHeight/2)
        .attr("y", -38))
        .text("VST expression")
    
    const titleText = plotTitle(plotArea.append("text")
        .attr("transform", `translate(0,-18)`))
        .style("font-family", THEME.fontMono)

    const confIntGroup = plotArea.append("g").attr("class", "conf-int-group")
    const samplesGroup = plotArea.append("g").attr("class", "samples-group")
    const muGroup = plotArea.append("g").attr("class", "mu-group")
    const vstDotsGroup = plotArea.append("g").attr("class", "vst-dots-group")

    // "phase" = one period, phase-wrapped; "full" = tiled across the 48 h experiment
    let viewMode = "phase"
    let lastPayload = null

    /** Repeat one-period series across [0, hours], stopping once x exceeds the window. */
    function tileOverHours(period, nGrid, hours, getPoint) {
        const pts = []
        const maxCycles = Math.ceil(hours / period) + 1
        for (let c = 0; c < maxCycles; c++) {
            for (let i = 0; i < nGrid; i++) {
                const x = c * period + (i * period) / nGrid
                if (x > hours) return pts
                pts.push(getPoint(i, x))
            }
        }
        return pts
    }

    function drawDayNightShade(enabled) {
        shadeGroup.selectAll("*").remove()
        if (!enabled) return
        const bands = [
            [0, 16, PALETTE.sand, 0.28],
            [16, 24, PALETTE.indigo, 0.12],
            [24, 40, PALETTE.sand, 0.28],
            [40, 48, PALETTE.indigo, 0.12],
        ]
        for (const [x0, x1, color, opacity] of bands) {
            shadeGroup.append("rect")
                .attr("x", xScale(x0))
                .attr("y", 0)
                .attr("width", xScale(x1) - xScale(x0))
                .attr("height", innerHeight)
                .attr("fill", color)
                .attr("opacity", opacity)
        }
    }

    function syncToggleUI() {
        const phaseBtn = document.getElementById("StepSeqGPViewPhase")
        const fullBtn = document.getElementById("StepSeqGPViewFull")
        if (phaseBtn) phaseBtn.setAttribute("aria-pressed", String(viewMode === "phase"))
        if (fullBtn) fullBtn.setAttribute("aria-pressed", String(viewMode === "full"))
    }

    function setViewMode(mode) {
        if (mode !== "phase" && mode !== "full") return
        if (viewMode === mode) return
        viewMode = mode
        syncToggleUI()
        if (lastPayload) updatePlot(lastPayload)
        else renderEmpty()
    }

    // default display
    function renderEmpty(){
        lastPayload = null
        const xMax = viewMode === "full" ? EXPERIMENT_HOURS : 24
        xScale.domain([0, xMax])
        yScale.domain([0, 100])
        drawDayNightShade(viewMode === "full")
        const xAxis = d3.axisBottom(xScale)
        if (viewMode === "full") xAxis.tickValues(VST_TIMES)
        xAxisG.call(xAxis)
        yAxisG.call(d3.axisLeft(yScale))
        titleText.text("gene ID")

        confIntGroup.selectAll("*").remove()
        samplesGroup.selectAll("*").remove()
        muGroup.selectAll("*").remove()
        vstDotsGroup.selectAll("*").remove()
    }

    function updatePlot(payload) {
        const { metaValues, shared, cur_mu: mu, cur_std: std, meta_item, VST_dat } = payload
        if (!meta_item || !mu || !std || !VST_dat) return
        lastPayload = payload

        const base = meta_item.index * metaValues.BLOCK
        const period = meta_item.period
        const nGrid = metaValues.N_GRID
        // Inverse of peak-norm in load_waveforms (midrange center + half-range scale)
        const center = (meta_item.wave_max + meta_item.wave_min) / 2
        const scale = (meta_item.wave_max - meta_item.wave_min) / 2 || 1.0

        const sample_wavs = Array.from({ length: metaValues.N_SAMPLES }, (_, i) =>
            new Float32Array(shared, (base + nGrid * i) * 4, nGrid)
        )

        const bandLo = mu.map((m, i) => m - 2 * std[i])
        const bandHi = mu.map((m, i) => m + 2 * std[i])
        const plot_min = d3.min([...bandLo, meta_item.wave_min])
        const plot_max = d3.max([...bandHi, meta_item.wave_max])

        const xMax = viewMode === "full" ? EXPERIMENT_HOURS : period
        xScale.domain([0, xMax]).nice()
        yScale.domain([plot_min, plot_max]).nice()
        drawDayNightShade(viewMode === "full")
        const xAxis = d3.axisBottom(xScale)
        if (viewMode === "full") xAxis.tickValues(VST_TIMES)
        xAxisG.transition().duration(300).call(xAxis)
        yAxisG.transition().duration(300).call(d3.axisLeft(yScale))
        titleText.text(meta_item.GeneID)

        const mu_std_dat = viewMode === "full"
            ? tileOverHours(period, nGrid, EXPERIMENT_HOURS, (i, x) => ({
                x, mu: mu[i], std: std[i],
            }))
            : Array.from({ length: nGrid }, (_, idx) => ({
                x: (idx * period) / nGrid,
                mu: mu[idx],
                std: std[idx],
            }))

        const area = d3.area()
            .x((d) => xScale(d.x))
            .y0((d) => yScale(d.mu + 2 * d.std))
            .y1((d) => yScale(d.mu - 2 * d.std))

        confIntGroup.selectAll("path")
            .data([mu_std_dat])
            .join("path")
            .attr("fill", PALETTE.indigo)
            .attr("opacity", 0.12)
            .attr("stroke", "none")
            .attr("d", (d) => area(d))

        const sampleSeries = sample_wavs.map((wav) =>
            viewMode === "full"
                ? tileOverHours(period, nGrid, EXPERIMENT_HOURS, (i, x) => ({
                    x, y: wav[i] * scale + center,
                }))
                : Array.from({ length: nGrid }, (_, i) => ({
                    x: (i * period) / nGrid,
                    y: wav[i] * scale + center,
                }))
        )

        const lineXY = d3.line()
            .x((d) => xScale(d.x))
            .y((d) => yScale(d.y))

        samplesGroup.selectAll("path")
            .data(sampleSeries)
            .join("path")
            .attr("fill", "none")
            .attr("stroke", PALETTE.teal)
            .attr("stroke-width", 1.75)
            .attr("opacity", 0.55)
            .attr("d", (dat) => lineXY(dat))

        const muSeries = viewMode === "full"
            ? tileOverHours(period, nGrid, EXPERIMENT_HOURS, (i, x) => ({ x, y: mu[i] }))
            : Array.from({ length: nGrid }, (_, i) => ({
                x: (i * period) / nGrid,
                y: mu[i],
            }))

        muGroup.selectAll("path")
            .data([muSeries])
            .join("path")
            .attr("fill", "none")
            .attr("stroke", PALETTE.indigo)
            .attr("stroke-width", 2.5)
            .attr("opacity", 0.95)
            .attr("d", (d) => lineXY(d))

        const vst_y = ldTimepoints(VST_dat)
        const vst_points = viewMode === "full"
            ? VST_TIMES.map((x, i) => ({ x, y: vst_y[i] }))
            // phase-folded onto [0, period)
            : VST_TIMES.map((t, i) => ({ x: t % period, y: vst_y[i] }))

        vstDotsGroup.selectAll("circle")
            .data(vst_points)
            .join("circle")
            .attr("r", 4.5)
            .attr("fill", PALETTE.rose)
            .attr("stroke", "#fff")
            .attr("stroke-width", 1.5)
            .attr("cx", (d) => xScale(d.x))
            .attr("cy", (d) => yScale(d.y))
    }

    document.getElementById("StepSeqGPViewPhase")?.addEventListener("click", () => setViewMode("phase"))
    document.getElementById("StepSeqGPViewFull")?.addEventListener("click", () => setViewMode("full"))
    syncToggleUI()
    renderEmpty()

    return {renderEmpty, updatePlot, setViewMode}
}
