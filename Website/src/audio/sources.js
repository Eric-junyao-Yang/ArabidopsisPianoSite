// Building blocks shared by the AudioWorklet processors (synth, jukebox).
//
// A "source" is what a voice reads its waveform from. Every source has the same two methods:
//   prepareBlock(n)    once per audio block, before any voice renders (advances shared state)
//   sample(phase, i)   bipolar sample in [-1, 1] at table position `phase` (0..TABLE_SIZE) for frame i
// so voices don't need to know whether they play a fixed gene table or morphing GP draws.
//
// Runs on the audio thread: nothing here allocates after construction.

import { catmullrom, writeUnipolarWavetable } from "../catmullrom.js"

export const TABLE_SIZE = 2048

/** Advance a voice's attack / release envelope by one frame. Sustain holds; the caller decides when to release. */
export function stepEnvelope(voice, attackInc, releaseInc) {
    if (voice.state === "attack") {
        voice.lvl += attackInc
        if (voice.lvl >= 1) {
            voice.lvl = 1
            voice.state = "sustain"
        }
    } else if (voice.state === "release") {
        voice.lvl -= releaseInc
        if (voice.lvl <= 0) {
            voice.lvl = 0
            voice.state = "finished"
        }
    }
}

/** Periodic Catmull-Rom read of a table at a fractional position. */
export function gatherCatmullrom(table, phase, size = table.length) {
    const p1 = Math.floor(phase) % size
    return catmullrom(
        table[(p1 - 1 + size) % size],
        table[p1],
        table[(p1 + 1) % size],
        table[(p1 + 2) % size],
        phase - Math.floor(phase),
    )
}

/** One fixed wavetable, e.g. a gene's 16 VST points. */
export class StaticSource {
    constructor(points) {
        this.table = new Float32Array(TABLE_SIZE)
        writeUnipolarWavetable(points, this.table, new Float64Array(TABLE_SIZE))
    }

    prepareBlock() {}

    // Linear read, as the synth / jukebox have always done for gene tables
    sample(phase) {
        const base = Math.floor(phase)
        const i0 = base % TABLE_SIZE
        const i1 = (i0 + 1) % TABLE_SIZE
        const frac = phase - base
        return (this.table[i0] * (1 - frac) + this.table[i1] * frac) * 2 - 1
    }
}

/**
 * Endless morph through random draws from one gene's GP posterior.
 *
 * The posterior arrives once (mu over the 24 h grid, and L, the flat row-major Cholesky factor of its
 * covariance; see gpSamplerClass.posterior). Draws are made here (mu + L z), so there is no
 * request / response with the main thread. The queue is refilled the moment a draw is used up,
 * so it never runs dry.
 *
 * Sound crossfades queue[0] -> queue[1] over `sweepSeconds`, then shifts. The sweep clock is per
 * source: every voice reading this source morphs between the same two draws at the same frame.
 */
export class GPSource {
    /**
     * @param {Float64Array} mu  posterior mean, n grid points
     * @param {Float64Array} L   Cholesky factor of the posterior covariance, n*n row-major
     * @param {object} [opts]
     * @param {number} [opts.sweepSeconds=0.5]  time to morph from one draw to the next
     * @param {number} [opts.queueSize=3]       draws kept ready (>= 2: current + target)
     * @param {(draw: Float64Array) => void} [opts.onTarget]  called with each draw the sound starts
     *        morphing towards (e.g. to plot it). The array is reused afterwards, so copy or post it.
     */
    constructor(mu, L, { sweepSeconds = 0.5, queueSize = 3, onTarget = null } = {}) {
        this.mu = mu
        this.L = L
        this.n = mu.length
        this.sweepInc = 1 / (sampleRate * sweepSeconds)
        this.onTarget = onTarget

        // Preallocated draw slots, recycled as draws are used up
        this.free = Array.from({ length: Math.max(2, queueSize) }, () => ({
            draw: new Float64Array(this.n), // posterior sample on the GP grid (for plotting)
            table: new Float32Array(TABLE_SIZE), // the same sample as a playable wavetable
        }))
        this.queue = []
        this.z = new Float64Array(this.n)
        this.scratch = new Float64Array(TABLE_SIZE)

        this.sweep = 0
        // Per-frame blend for the current block (see prepareBlock)
        this.blockA = []
        this.blockB = []
        this.blockW = new Float32Array(0)

        this.refill()
        this.onTarget?.(this.queue[1].draw)
    }

    /** Start / stop reporting draws (e.g. when the plot starts watching); reports the current target at once. */
    setOnTarget(onTarget) {
        this.onTarget = onTarget
        onTarget?.(this.queue[1].draw)
    }

    standardNormals() {
        const z = this.z
        for (let i = 0; i < z.length; i += 2) {
            const r = Math.sqrt(-2 * Math.log(Math.max(Math.random(), 1e-12)))
            const theta = 2 * Math.PI * Math.random()
            z[i] = r * Math.cos(theta)
            if (i + 1 < z.length) z[i + 1] = r * Math.sin(theta)
        }
    }

    // mu + L z into a free slot, then build its wavetable
    drawInto(slot) {
        const { mu, L, n, z } = this
        this.standardNormals()
        for (let i = 0; i < n; i++) {
            let value = mu[i]
            const row = i * n
            for (let p = 0; p <= i; p++) value += L[row + p] * z[p]
            slot.draw[i] = value
        }
        writeUnipolarWavetable(slot.draw, slot.table, this.scratch)
    }

    refill() {
        while (this.free.length) {
            const slot = this.free.pop()
            this.drawInto(slot)
            this.queue.push(slot)
        }
    }

    // Per frame: which two tables to blend and by how much. The shift can land mid-block,
    // so frames before it blend (draw 1, draw 2) and frames after it (draw 2, draw 3).
    prepareBlock(n) {
        if (this.blockW.length !== n) {
            this.blockA = new Array(n)
            this.blockB = new Array(n)
            this.blockW = new Float32Array(n)
        }
        const q = this.queue
        for (let i = 0; i < n; i++) {
            this.blockA[i] = q[0].table
            this.blockB[i] = q[1].table
            this.blockW[i] = this.sweep
            this.sweep += this.sweepInc
            if (this.sweep >= 1) {
                // Output is ~100% q[1] here, which becomes q[0] at weight 0: no jump
                this.free.push(q.shift())
                this.sweep = 0
                this.refill()
                this.onTarget?.(q[1].draw)
            }
        }
    }

    sample(phase, i) {
        const w = this.blockW[i]
        const a = gatherCatmullrom(this.blockA[i], phase, TABLE_SIZE)
        const b = gatherCatmullrom(this.blockB[i], phase, TABLE_SIZE)
        return (a * (1 - w) + b * w) * 2 - 1
    }
}
