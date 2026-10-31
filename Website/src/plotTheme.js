// Shared look for every plot: Paul Tol "muted" colorblind-safe palette + axis/label helpers.

export const PALETTE = {
    indigo: "#332288",
    green: "#117733",
    teal: "#44AA99",
    sky: "#88CCEE",
    sand: "#DDCC77",
    rose: "#CC6677",
    purple: "#AA4499",
    wine: "#882255",
}

// Ordered so neighbours are easy to tell apart (use for categorical series).
export const CATEGORICAL = [
    PALETTE.indigo,
    PALETTE.rose,
    PALETTE.teal,
    PALETTE.sand,
    PALETTE.purple,
    PALETTE.green,
    PALETTE.sky,
    PALETTE.wine,
]

export const THEME = {
    ink: "#1b1d29",
    muted: "#595f72",
    grid: "#e3e6ee",
    axis: "#c9cedb",
    surface: "#ffffff",
    // 'in range / active' vs 'filtered out' points
    pointActive: PALETTE.indigo,
    pointInactive: "#b4b9c8",
    hover: PALETTE.teal,
    selected: PALETTE.sand,
    fontMono: '"JetBrains Mono", ui-monospace, Menlo, Consolas, monospace',
}

/** "#rrggbb" -> [r, g, b] in 0..1 (for WebGL uniforms / shaders). */
export function hexToRgb01(hex) {
    const n = parseInt(hex.slice(1), 16)
    return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}

/** "#rrggbb" + alpha -> "rgba(...)" for canvas 2D. */
export function withAlpha(hex, a) {
    const [r, g, b] = hexToRgb01(hex).map((v) => Math.round(v * 255))
    return `rgba(${r}, ${g}, ${b}, ${a})`
}

/** Render a d3 axis into `g` with the shared minimal styling (no heavy domain line, soft ticks). */
export function drawAxis(g, axis) {
    g.call(axis)
    styleAxis(g)
    return g
}

export function styleAxis(g) {
    g.select(".domain").attr("stroke", THEME.axis)
    g.selectAll(".tick line").attr("stroke", THEME.axis)
    g.selectAll(".tick text")
        .attr("fill", THEME.muted)
        .attr("font-size", 11)
        .style("font-variant-numeric", "tabular-nums")
    return g
}

export function axisLabel(sel) {
    return sel.attr("fill", THEME.muted).attr("font-size", 11).attr("text-anchor", "middle")
}

export function plotTitle(sel) {
    return sel
        .attr("fill", THEME.ink)
        .attr("font-size", 13)
        .attr("font-weight", 600)
        .attr("text-anchor", "start")
}

/**
 * Size to give a plot drawn inside `el`: the container's current box, clamped.
 * Falls back to the requested size if the container hasn't been laid out yet.
 */
export function containerSize(el, fallbackW, fallbackH, minW = 240, minH = 240) {
    const w = el.clientWidth || fallbackW
    const h = el.clientHeight || fallbackH
    return [Math.max(minW, Math.floor(w)), Math.max(minH, Math.floor(h))]
}

/** Call `fn` (debounced) whenever `el` changes size. Returns a disconnect function. */
export function onResize(el, fn, delay = 150) {
    let last = [el.clientWidth, el.clientHeight]
    let t = null
    const ro = new ResizeObserver(() => {
        const cur = [el.clientWidth, el.clientHeight]
        if (cur[0] === last[0] && cur[1] === last[1]) return
        last = cur
        clearTimeout(t)
        t = setTimeout(fn, delay)
    })
    ro.observe(el)
    return () => {
        clearTimeout(t)
        ro.disconnect()
    }
}
