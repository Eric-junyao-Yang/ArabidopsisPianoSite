/**
 * Harmonic series table: the fundamental's frequency is an input, and every
 * <output data-ratio="k"> shows k times it. An empty or out-of-range entry shows dashes
 * until it is valid again, and the field snaps back to the last valid value on blur.
 */
export function mountHarmonicsTable(table) {
    if (!table) return
    const input = table.querySelector(".harmonics-table__fundamental")
    if (!input) return
    const outputs = [...table.querySelectorAll("output[data-ratio]")]
    const min = Number(input.min) || 0
    const max = Number(input.max) || Infinity
    let lastValid = Number(input.value)

    // Whole hertz is plenty here, and keeps 440.1 × 7 from printing float noise
    const format = (hz) => Math.round(hz).toLocaleString()

    const render = () => {
        const fundamental = input.valueAsNumber
        const valid = Number.isFinite(fundamental) && fundamental >= min && fundamental <= max
        input.setAttribute("aria-invalid", String(!valid))
        if (valid) lastValid = fundamental
        for (const output of outputs) {
            output.textContent = valid ? format(fundamental * Number(output.dataset.ratio)) : "–"
        }
    }

    input.addEventListener("input", render)
    input.addEventListener("change", () => {
        if (input.getAttribute("aria-invalid") === "true") input.value = String(lastValid)
        render()
    })
    render()
}
