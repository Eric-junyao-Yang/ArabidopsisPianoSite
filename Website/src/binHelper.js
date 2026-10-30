const metaJsonCache = new Map()

export async function meta_to_json(path_to_meta, file_name) {
    let meta_json = metaJsonCache.get(path_to_meta)
    if (!meta_json) {
        const resp = await fetch(path_to_meta)
        if (!resp.ok) {
            throw new Error(`Failed to fetch meta ${path_to_meta}: ${resp.status}`)
        }
        meta_json = await resp.json()
        metaJsonCache.set(path_to_meta, meta_json)
    }
    const meta_json_dat = meta_json[file_name]
    if (!meta_json_dat) {
        throw new Error(`No entry "${file_name}" in ${path_to_meta}`)
    }
    return meta_json_dat
}

export async function bin_to_array(path_to_bin, path_to_meta) {
    const file_name = path_to_bin.split("/").pop()
    const meta_json_dat = await meta_to_json(path_to_meta, file_name)

    const resp = await fetch(path_to_bin)
    if (!resp.ok) {
        throw new Error(`Failed to fetch bin ${path_to_bin}: ${resp.status}`)
    }
    const flat_arr = new Float32Array(await resp.arrayBuffer())

    const { n, d, colnames, rownames } = meta_json_dat
    if (flat_arr.length !== n * d) {
        throw new Error(
            `${file_name}: expected ${n * d} floats, got ${flat_arr.length}`
        )
    }

    return Array.from({ length: n }, (_, i) => {
        const row = rownames ? { GeneID: rownames[i] } : {}
        for (let k = 0; k < d; k++) {
            row[colnames[k]] = flat_arr[i * d + k]
        }
        return row
    })
}

/**
 * Load GP waveforms into a SharedArrayBuffer for the step-seq audio worklet.
 * Copies mu/std out (VST scale), then peak-normalizes the N_SAMPLES curves in place for audio.
 */

export async function load_waveforms(path_to_bin, path_to_meta) {
    const file_name = path_to_bin.split("/").pop()
    const meta_json = await meta_to_json(path_to_meta, file_name)

    const resp = await fetch(path_to_bin)
    if (!resp.ok) {
        throw new Error(`Failed to fetch waveforms ${path_to_bin}: ${resp.status}`)
    }
    const buff = await resp.arrayBuffer()

    const nrows = meta_json.meta.length
    const { N_GRID, N_SAMPLES, N_WAVES, WAVE_KEYS, BYTE_OFFSET } = meta_json
    const BLOCK = N_WAVES * N_GRID

    if (BYTE_OFFSET != null && BYTE_OFFSET !== BLOCK * 4) {
        throw new Error(
            `waveforms BYTE_OFFSET ${BYTE_OFFSET} != N_WAVES*N_GRID*4 (${BLOCK * 4})`
        )
    }
    if (buff.byteLength !== nrows * BLOCK * 4) {
        throw new Error(
            `waveforms.bin size ${buff.byteLength} != ${nrows} genes * ${BLOCK * 4}`
        )
    }

    const metaValues = {
        N_GRID,
        N_SAMPLES,
        N_WAVES,
        BLOCK,
        nrows,
        WAVE_KEYS,
    }

    const shared = new SharedArrayBuffer(buff.byteLength)
    const sharedView = new Float32Array(shared)
    sharedView.set(new Float32Array(buff))

    const mu = new Array(nrows)
    const std = new Array(nrows)

    for (let i = 0; i < nrows; i++) {
        const base = BLOCK * i
        mu[i] = new Float32Array(
            shared,
            (base + N_GRID * N_SAMPLES) * 4,
            N_GRID
        ).slice()
        std[i] = new Float32Array(
            shared,
            (base + N_GRID * (N_SAMPLES + 1)) * 4,
            N_GRID
        ).slice()
    }

    // Peak-normalize sample curves only (audio loudness); mu/std stay in VST units
    for (let i = 0; i < nrows; i++) {
        const allWaves = new Float32Array(shared, BLOCK * i * 4, N_GRID * N_SAMPLES)

        let vmin = Infinity
        let vmax = -Infinity
        for (let j = 0; j < allWaves.length; j++) {
            const v = allWaves[j]
            if (v < vmin) vmin = v
            if (v > vmax) vmax = v
        }

        const center = (vmax + vmin) / 2
        const scale = (vmax - vmin) / 2 || 1.0
        meta_json.meta[i].wave_min = vmin
        meta_json.meta[i].wave_max = vmax

        for (let j = 0; j < allWaves.length; j++) {
            allWaves[j] = (allWaves[j] - center) / scale
        }
    }

    return [metaValues, meta_json.meta, shared, mu, std]
}
