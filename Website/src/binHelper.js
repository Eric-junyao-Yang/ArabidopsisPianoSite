export async function meta_to_json(path_to_meta, file_name){
    const resp_meta = await fetch(path_to_meta)
    const meta_json = await resp_meta.json()
    const meta_json_dat = meta_json[file_name]
    return meta_json_dat
}

export async function bin_to_array(path_to_bin, path_to_meta){
    const file_name = path_to_bin.split("/").pop()
    const meta_json_dat = await meta_to_json(path_to_meta, file_name)

    const resp_bin = await fetch(path_to_bin)
    const buff = await resp_bin.arrayBuffer()
    const flat_arr = new Float32Array(buff)

    const n = meta_json_dat.n
    const d = meta_json_dat.d
    const colnames = meta_json_dat.colnames

    const arr = Array.from({length: meta_json_dat.n}, (_, i) => {
        const row = {}
        for (let k=0; k<d; k++){
            row[colnames[k]] = flat_arr[i * d + k]
        }
        return row
    })

    return arr
}

export function append_id_logCount_to_array(input_array, list_of_id, list_of_logCount){
    return input_array.map((val, idx) => (
        {
            ...val, 
            log_mean_count: list_of_logCount[idx],
            id: list_of_id[idx]
        }
    ))
}