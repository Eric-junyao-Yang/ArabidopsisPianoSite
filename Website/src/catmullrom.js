export function catmullrom(p0, p1, p2, p3, t) {
    const t2 = t * t
    const t3 = t2 * t
    return 0.5 * (
        (2 * p1) +
        (-p0 + p2) * t +
        (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
        (-p0 + 3 * p1 - 3 * p2 + p3) * t3
    )
}

/** Mean-center then scale so max |value| = 1. Flat inputs = zeros. (No d3 — safe in AudioWorklet.) */
export function maxAbsScaling(input_array) {
    const n = input_array.length
    if (n === 0) return []
    let sum = 0
    for (let i = 0; i < n; i++) sum += input_array[i]
    const mu = sum / n

    const centered = new Array(n)
    let max = 0
    for (let i = 0; i < n; i++) {
        const v = input_array[i] - mu
        centered[i] = v
        const a = v < 0 ? -v : v
        if (a > max) max = a
    }
    if (!(max > 0)) {
        centered.fill(0)
        return centered
    }
    for (let i = 0; i < n; i++) centered[i] /= max
    return centered
}

/** Periodic Catmull–Rom resample of a closed loop (e.g. one cycle of expression). */
export function interpolate_waveform(input_array, output_n_points) {
    const n = input_array.length
    const output_array = new Array(output_n_points)

    for (let i = 0; i < output_n_points; i++) {
        const pos = i * (n / output_n_points)
        const P1 = Math.floor(pos)
        const P2 = P1 + 1
        const P0 = P1 - 1
        const P3 = P2 + 1
        const t = pos - P1

        const p0 = input_array[(P0 + n) % n]
        const p1 = input_array[P1 % n]
        const p2 = input_array[P2 % n]
        const p3 = input_array[P3 % n]

        output_array[i] = catmullrom(p0, p1, p2, p3, t)
    }

    return output_array
}

/**
 * Canonical audio wavetable build: interpolate → maxAbs (bipolar) → [0, 1].
 * Worklets map back with `sample * 2 - 1`.
 */
export function toUnipolarWavetable(input_array, output_n_points) {
    const bipolar = maxAbsScaling(interpolate_waveform(input_array, output_n_points))
    const table = new Float32Array(bipolar.length)
    for (let i = 0; i < bipolar.length; i++) {
        table[i] = (bipolar[i] + 1) * 0.5
    }
    return table
}

/** Extract LD_* timepoint values in chronological column order. */
export function ldTimepoints(row) {
    return Object.keys(row)
        .filter((k) => k.startsWith("LD_"))
        .sort()
        .map((k) => row[k])
}
