export function catmullrom(p0, p1, p2, p3, t){
    const t2 = t * t
    const t3 = t2 * t
    return 0.5 *((2 * p1) + 
    (-p0 + p2) * t + 
    (2*p0 - 5*p1 + 4*p2 - p3) * t2 + 
    (-p0 + 3*p1- 3*p2 + p3) * t3)
}

export function maxAbsScaling(input_array){
    // Mean center
    const mu = d3.mean(input_array)
    let output_array = input_array.map((v,i) => v - mu)
    // AbsMax
    const max = Math.max(...output_array.map((v,i) => Math.abs(v)))
    return output_array.map((v, i) => v / max)
}


export function interpolate_waveform(input_array, output_n_points){

    const n = input_array.length
    const output_array = new Array(output_n_points)
    
    for (let i=0; i < output_n_points; i++){
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