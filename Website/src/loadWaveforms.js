export async function load_waveforms(path_to_bin, path_to_meta){
    const resp_meta = await fetch(path_to_meta)
    const meta_json = await resp_meta.json()
    
    const bin = await fetch(path_to_bin)
    const buff = await bin.arrayBuffer()
    
    const nrows = meta_json.meta.length
    const metaValues = {
        'N_GRID' : meta_json.N_GRID,
        "N_SAMPLES" : meta_json.N_SAMPLES,
        "N_WAVES" : meta_json.N_WAVES,
        "BLOCK" : meta_json.N_WAVES * meta_json.N_GRID,
        "nrows" : meta_json.meta.length,
        "WAVE_KEYS" : meta_json.WAVE_KEYS,
    }

    const shared = new SharedArrayBuffer(buff.byteLength) //This will be passed to audio_processor
    const sharedView = new Float32Array(shared)
    sharedView.set(new Float32Array(buff))

    // pull mu and std info
    const mu = new Array(nrows)
    const std = new Array(nrows)

    for (let i=0; i<nrows; i++){
        const base = metaValues.N_GRID * metaValues.N_WAVES * i
        mu[i] = new Float32Array(
            shared,
            (base + metaValues.N_GRID*metaValues.N_SAMPLES) * 4,
            metaValues.N_GRID
        ).slice()
        std[i] = new Float32Array(
            shared,
            (base + metaValues.N_GRID*(metaValues.N_SAMPLES+1)) * 4,
            metaValues.N_GRID
        ).slice()
    }

    // mean-center, then normalize on the samples per gene, in place

    for (let i=0; i < nrows; i++){
        const base = metaValues.BLOCK * i

        const allWaves = new Float32Array(shared, base * 4, metaValues.N_GRID * metaValues.N_SAMPLES)

        let vmin = Infinity, vmax = -Infinity
        let sum = 0
        for (let j=0; j < allWaves.length; j++){
            if (allWaves[j] < vmin) vmin = allWaves[j]
            if (allWaves[j] > vmax) vmax = allWaves[j]
            sum += allWaves[j]
        } 

        // const center = (vmax + vmin) / 2
        const center = sum / allWaves.length
        const scale = (vmax - vmin) / 2 || 1.0
        meta_json.meta[i].wave_min = vmin
        meta_json.meta[i].wave_max = vmax

        for (let j=0;j<allWaves.length;j++){
            allWaves[j] = (allWaves[j] - center) / scale
        }
    }
    return [metaValues, meta_json, shared, mu, std]
}