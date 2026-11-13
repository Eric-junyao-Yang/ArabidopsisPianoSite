import { THEME, withAlpha, drawAxis, axisLabel, plotTitle, containerSize, onResize } from "/src/plotTheme.js"
import {
    buildColorRgbArr,
    rgb01ToCss,
    selectedEnergyPeriodHours,
} from "/src/umap/umapColors.js"
import {
    ScatterGL,
    ACTIVE_ALPHA,
    INACTIVE_ALPHA,
    OUTLINE_ALPHA,
    POINT_RADIUS_PX,
    POINT_OUTLINE_PX,
} from "/src/umap/umapScatterGL.js"
import { renderColorLegend } from "/src/umap/umapLegend.js"

export { selectedEnergyPeriodHours }

// width/height are fallbacks: the plot fills its container and redraws (keeping filter + selection)
// when the container is resized.
// Returns { setData, destroy } — use setData(nextUmapArr) to swap embeddings (e.g. all vs circadian)
// without stacking ResizeObservers / WebGL contexts (re-calling plotUMAP would).
export function plotUMAP(width, height, umap_arr, per_gene_meta, specsLookup, div_name, plot_title, displayGeneID = false, bus){
    const container = document.getElementById(div_name)
    // State that must survive a redraw (resize or setData)
    const state = { low: null, high: null, selected: null, colorMode: "none", displayMode: "All" }
    let data = umap_arr
    let current = null

    function redraw() {
        current?.destroy()
        // keep non-plot children (e.g. the help button added by helpPopup.js)
        container.querySelectorAll(':scope > svg, :scope > canvas').forEach((n) => n.remove())
        const [w, h] = containerSize(container, width, height)
        current = buildUMAP(w, h, data, per_gene_meta, specsLookup, div_name, plot_title, displayGeneID, bus, state)
    }

    /** @param {string} [displayMode] "All" | "Circadian" — selects LS vs MetaCycle metrics */
    function setData(nextArr, displayMode) {
        data = nextArr
        if (displayMode === "All" || displayMode === "Circadian") state.displayMode = displayMode
        redraw()
    }

    redraw()
    const stopResize = onResize(container, redraw)
    return {
        setData,
        destroy() {
            stopResize()
            current?.destroy()
            current = null
        },
    }
}

function buildUMAP(width, height, umap_arr, per_gene_meta, specsLookup, div_name, plot_title, displayGeneID, bus, state){

    const margin = { top: 34, right: 16, bottom: 40, left: 46 }
    const dpr = window.devicePixelRatio || 1 //1 css coordinate = typically 2x2 physical pixel
    const innerWidth = width - margin.left - margin.right
    const innerHeight = height - margin.top - margin.bottom
    const physicalWidth = innerWidth * dpr
    const physicalHeight = innerHeight * dpr

    const xScale = d3.scaleLinear()
    .domain(d3.extent(umap_arr, d => d.x))
    .range([0, innerWidth])
    .nice()

    const yScale = d3.scaleLinear()
    .domain(d3.extent(umap_arr, d => d.y))
    .range([innerHeight, 0])
    .nice()

    //Allow current scale to be passed via bus
    let currentXScale = xScale
    let currentYScale = yScale

    //Set up svg (axis + titles etc) & mainCanvas (points)

    const svg = d3.select(`#${div_name}`)
        .append("svg")
        .attr('width', width)
        .attr('height', height)
        .style('position', 'absolute')
        .style('top', '0')
        .style('left', '0')
        .style('pointer-events', 'none')

    const plotArea = svg.append('g')
        .attr('transform', `translate(${margin.left},${margin.top})`)

    const mainCanvas = d3.select(`#${div_name}`)
        .append('canvas')
        .attr('width', physicalWidth)
        .attr('height', physicalHeight)
        .style('width', innerWidth + 'px')
        .style('height', innerHeight + 'px')
        .style('position', 'absolute')
        .style('top', margin.top + 'px')
        .style('left', margin.left + 'px')

    const metaByGene = new Map(per_gene_meta.map((d) => [d.GeneID, d]))
    let colorRgbArr = buildColorRgbArr(state.colorMode, umap_arr, metaByGene, specsLookup, state.displayMode)

    // ---- WebGL ----
    const scatter = new ScatterGL(
        mainCanvas.node(),
        umap_arr,
        colorRgbArr,
        xScale,
        yScale,
        innerWidth,
        innerHeight,
        dpr
    )

    let [internal_low_val, internal_high_val] = yScale.domain()
    if (state.low !== null) { internal_low_val = state.low; internal_high_val = state.high }

    // CPU fallback — inactive batch, then per-point active colors
    function drawPointsCanvas(mainCtx, xSc, ySc, high_val = internal_high_val, low_val = internal_low_val) {
        mainCtx.clearRect(0, 0, innerWidth, innerHeight)
        mainCtx.lineWidth = POINT_OUTLINE_PX
        mainCtx.strokeStyle = withAlpha(THEME.ink, OUTLINE_ALPHA)

        mainCtx.fillStyle = withAlpha(THEME.pointInactive, INACTIVE_ALPHA)
        mainCtx.beginPath()
        for (let i = 0; i < umap_arr.length; i++) {
            const d = umap_arr[i]
            if (d.log_TPM >= low_val && d.log_TPM <= high_val) continue
            mainCtx.moveTo(xSc(d.x) + POINT_RADIUS_PX, ySc(d.y))
            mainCtx.arc(xSc(d.x), ySc(d.y), POINT_RADIUS_PX, 0, 2 * Math.PI)
        }
        mainCtx.fill()

        for (let i = 0; i < umap_arr.length; i++) {
            const d = umap_arr[i]
            if (d.log_TPM < low_val || d.log_TPM > high_val) continue
            mainCtx.fillStyle = rgb01ToCss(
                [colorRgbArr[i * 3], colorRgbArr[i * 3 + 1], colorRgbArr[i * 3 + 2]],
                ACTIVE_ALPHA,
            )
            mainCtx.beginPath()
            mainCtx.arc(xSc(d.x), ySc(d.y), POINT_RADIUS_PX, 0, 2 * Math.PI)
            mainCtx.fill()
            mainCtx.stroke()
        }
    }

    const legend = plotArea.append("g").attr("class", "umap-color-legend")
        .attr("transform", `translate(${innerWidth - 4}, 8)`)

    const legendCtx = {
        svg,
        legend,
        div_name,
        umap_arr,
        metaByGene,
        specsLookup,
        get displayMode() { return state.displayMode },
    }

    function applyColorMode(mode) {
        state.colorMode = mode
        colorRgbArr = buildColorRgbArr(mode, umap_arr, metaByGene, specsLookup, state.displayMode)
        if (scatter.isSupported) scatter.updateColors(colorRgbArr)
        else if (mainCtx) drawPointsCanvas(mainCtx, currentXScale, currentYScale)
        renderColorLegend(legendCtx, mode)
    }

    if (state.low !== null && scatter.isSupported) scatter.updateSelected(state.low, state.high)

    let mainCtx = null
    if (!scatter.isSupported) {
        //fallback
        console.warn('WebGL2 not supported, interactive visual elements may have slower performance with Canvas 2D')
        mainCtx = mainCanvas.node().getContext('2d', { willReadFrequently: true })
        mainCtx.scale(dpr, dpr)
    }

    const highlightCanvas = d3.select(`#${div_name}`)
        .append('canvas')
        .attr('width', physicalWidth)
        .attr('height', physicalHeight)
        .style('width', innerWidth + 'px')
        .style('height', innerHeight + 'px')
        .style('position', 'absolute')
        .style('top', margin.top + 'px')
        .style('left', margin.left + 'px')
        .style('pointer-events', 'none')
    
    let quadtree = null

    function rebuildQuadtree(xSc, ySc) {
        // Inclusive bounds — must match drawPointsCanvas / updateSelected
        const passed = umap_arr.filter(
            (d) => d.log_TPM >= internal_low_val && d.log_TPM <= internal_high_val
        )
        quadtree = d3.quadtree()
            .x(d => xSc(d.x))
            .y(d => ySc(d.y))
            .addAll(passed)
    }

    
    const hlightCtx = highlightCanvas.node().getContext('2d')
    hlightCtx.scale(dpr, dpr) // crisp markers on retina screens

    const HighlightPointSize = 5.5

    // Build a quick look up from GeneID -> Index
    const GeneID_Lookup = new Map(umap_arr.map(r => [r.GeneID, r]))
    var GeneID_select_current = state.selected

    // White halo + dark ring keeps the marker visible on dense, same-colored clusters
    function drawMarker(x, y, fill, r) {
        hlightCtx.beginPath()
        hlightCtx.arc(x, y, r + 2, 0, 2 * Math.PI)
        hlightCtx.fillStyle = 'rgba(255, 255, 255, 0.9)'
        hlightCtx.fill()
        hlightCtx.beginPath()
        hlightCtx.arc(x, y, r, 0, 2 * Math.PI)
        hlightCtx.fillStyle = fill
        hlightCtx.fill()
        hlightCtx.lineWidth = 1.5
        hlightCtx.strokeStyle = THEME.ink
        hlightCtx.stroke()
    }

    function drawHighlight(xSc, ySc, GeneID_hover, GeneID_select) {
        hlightCtx.clearRect(0,0,innerWidth, innerHeight)
        if (GeneID_hover) {
            const d_hover = GeneID_Lookup.get(GeneID_hover)
            if (d_hover) drawMarker(xSc(d_hover.x), ySc(d_hover.y), THEME.hover, HighlightPointSize)
        }
        if (GeneID_select) {
            const d_select = GeneID_Lookup.get(GeneID_select)
            if (d_select) drawMarker(xSc(d_select.x), ySc(d_select.y), THEME.selected, HighlightPointSize)
        }
    }

    if (!scatter.isSupported){drawPointsCanvas(mainCtx, xScale, yScale)}

    rebuildQuadtree(xScale, yScale)

    const xAxis = plotArea.append('g')
        .attr('transform', `translate(0, ${innerHeight})`)
    const yAxis = plotArea.append("g")
    const xAxisGen = (sc) => d3.axisBottom(sc).ticks(Math.max(3, Math.floor(innerWidth / 80))).tickSizeOuter(0)
    const yAxisGen = (sc) => d3.axisLeft(sc).ticks(Math.max(3, Math.floor(innerHeight / 60))).tickSizeOuter(0)
    drawAxis(xAxis, xAxisGen(xScale))
    drawAxis(yAxis, yAxisGen(yScale))

    axisLabel(plotArea.append("text")
        .attr("x", innerWidth / 2)
        .attr("y", innerHeight + 32))
        .text("dim1")

    axisLabel(plotArea.append("text")
        .attr("transform", "rotate(-90)")
        .attr("x", - innerHeight/2)
        .attr("y", -34))
        .text("dim2")

    plotTitle(plotArea.append("text")
        .attr("x", 0)
        .attr("y", -16))
        .text(plot_title)

    renderColorLegend(legendCtx, state.colorMode)

    const hoverLabel = plotArea.append("text")
        .attr("id", `hover-label-${div_name}`)
        .attr("x", innerWidth - 4)
        .attr("y", -16)
        .attr("text-anchor", "end")
        .attr("fill", THEME.hover === "#44AA99" ? "#2c7f72" : THEME.hover) // darker teal: AA contrast on white
        .attr("font-size", 12)
        .attr("font-weight", 600)
        .style("font-family", THEME.fontMono)

    // Custom mouse over behavior

    let lastEmittedRow = null //To avoid repeated signal

    mainCanvas.on('mousemove', (event) => {
        const [mx, my] = d3.pointer(event)
        const d = quadtree.find(mx, my, 4)

        if (!d) {
            if (lastEmittedRow !== null) {
                lastEmittedRow = null
                bus.execute_event('point_hover', null)
            }
            return
        }

        if (lastEmittedRow){
            if (d.id !== lastEmittedRow.id){
                lastEmittedRow = d
                bus.execute_event('point_hover', d.id)
            }
        } else {
            lastEmittedRow = d
            bus.execute_event('point_hover', d.id) 
        }


    })

    mainCanvas.on('mouseleave', () => {
        if (lastEmittedRow !== null) {
            lastEmittedRow = null
            bus.execute_event('point_hover', null)
        }
    })

    // Tell apart click from drag
    var mouseDownInit = null
    const DRAG_THRESHOLD = 4 //pixels
    // Tell single from double click
    var clickTimeout = null
    const DOUBLE_CLICK_GUARD = 150 //ms

    mainCanvas.on('mousedown', (event) => {
        const [mx, my] = d3.pointer(event)
        mouseDownInit = [mx, my]
    })

    mainCanvas.on('click', (event) => {
        if (!mouseDownInit) return
        
        const [mx, my] = d3.pointer(event)
        const dx = mx - mouseDownInit[0]
        const dy = my - mouseDownInit[1]
        const dist = Math.sqrt(dx*dx + dy*dy)
        mouseDownInit = null
        if (dist > DRAG_THRESHOLD) return
        
        
        if (clickTimeout) {
            clearTimeout(clickTimeout)
            clickTimeout = null
            return
        }

        clickTimeout = setTimeout(() => {
            clickTimeout = null
            const d = quadtree.find(mx, my, 4)
            if (d) {
                bus.execute_event('point_select', d.id)
            }
            else {
                bus.execute_event('point_select', null)
            }
        }, DOUBLE_CLICK_GUARD)
    })

    let rafId = null
    let destroyed = false
    const zoom = d3.zoom()
        .scaleExtent([1, 20])
        .extent([[0, 0], [innerWidth, innerHeight]])
        .on("zoom", (event) => {
            const zx = event.transform.rescaleX(xScale)
            const zy = event.transform.rescaleY(yScale)

            if (rafId) cancelAnimationFrame(rafId)
            rafId = requestAnimationFrame(() => {
                rafId = null
                if (destroyed) return
                if (!scatter.isSupported) {drawPointsCanvas(mainCtx, zx, zy, internal_high_val, internal_low_val)}
                else {scatter.updateTransform(event.transform)}
                // Clear hover during zoom; rebuild quadtree only on end (expensive)
                lastEmittedRow = null
                bus.execute_event('point_hover', null)
                drawHighlight(zx, zy, null, GeneID_select_current)
                drawAxis(xAxis, xAxisGen(zx))
                drawAxis(yAxis, yAxisGen(zy))
            })
        })
        .on("end", (event) => {
            if (destroyed) return
            const zx = event.transform.rescaleX(xScale)
            const zy = event.transform.rescaleY(yScale)
            currentXScale = zx
            currentYScale = zy
            if (!scatter.isSupported) {drawPointsCanvas(mainCtx, zx, zy, internal_high_val, internal_low_val)}
            else {scatter.updateTransform(event.transform)}
            lastEmittedRow = null
            bus.execute_event('point_hover', null)
            drawHighlight(zx, zy, null, GeneID_select_current)
            rebuildQuadtree(zx, zy)
            drawAxis(xAxis, xAxisGen(zx))
            drawAxis(yAxis, yAxisGen(zy))
        })

    mainCanvas.call(zoom)
    mainCanvas.on('dblclick.zoom', null)
    mainCanvas.on('dblclick', () => {
        mainCanvas.transition().duration(500).call(zoom.transform, d3.zoomIdentity)
    })

    //subscribe to bus events
    bus.subscribe_to("point_hover", div_name, (GeneID) => {
        if (destroyed) return
        drawHighlight(currentXScale, currentYScale, GeneID, GeneID_select_current)
        if (displayGeneID) hoverLabel.text(GeneID ?? '')
    })

    bus.subscribe_to("synth_TPM_filter", div_name, ([high_val, low_val]) => {
        if (destroyed) return
        if (!scatter.isSupported) {
            drawPointsCanvas(mainCtx, currentXScale, currentYScale, high_val, low_val)
            internal_high_val = high_val
            internal_low_val = low_val
            state.low = low_val; state.high = high_val
            rebuildQuadtree(currentXScale, currentYScale)
        }
        else {
            scatter.updateSelected(low_val, high_val)
            internal_high_val = high_val
            internal_low_val = low_val
            state.low = low_val; state.high = high_val
            rebuildQuadtree(currentXScale, currentYScale)
        }
    })

    bus.subscribe_to("umap_color_mode", div_name, (mode) => {
        if (destroyed) return
        applyColorMode(mode || "none")
    })

    bus.subscribe_to("point_select", div_name, (GeneID) => {
        if (destroyed) return
        drawHighlight(currentXScale, currentYScale, GeneID, GeneID)
        GeneID_select_current = GeneID
        state.selected = GeneID
    })

    if (GeneID_select_current) drawHighlight(currentXScale, currentYScale, null, GeneID_select_current)

    return {
        node: plotArea.node(),
        destroy() {
            destroyed = true
            if (rafId) cancelAnimationFrame(rafId)
            rafId = null
            if (clickTimeout) {
                clearTimeout(clickTimeout)
                clickTimeout = null
            }
            mainCanvas.on('.zoom', null)
            mainCanvas.on('mousemove', null)
            mainCanvas.on('mouseleave', null)
            mainCanvas.on('mousedown', null)
            mainCanvas.on('click', null)
            mainCanvas.on('dblclick', null)
            scatter.destroy()
        },
    }
}
