async function meta_to_json(path_to_meta, file_name){
    const resp_meta = await fetch(path_to_meta)
    const meta_json = await resp_meta.json()
    const meta_json_dat = meta_json[file_name]
    return meta_json_dat
}

async function bin_to_array(path_to_bin, path_to_meta){
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

function split_xy(arr){
    const len = arr.length
    const x = new Array(len)
    const y = new Array(len)
    for (let i=0; i<arr.length; i++){
        x[i] = arr[i].x
        y[i] = arr[i].y
    }
    return [x, y]
}

// const count_umap_arr = await bin_to_array(
//     "/run/media/yeti1t3y/Extreme SSD/My_Codes/ArabidopsisPiano/Processed_Data/count_umap.bin", 
//     "/run/media/yeti1t3y/Extreme SSD/My_Codes/ArabidopsisPiano/Processed_Data/bin_meta.json"
// )

// const fft_umap_arr = await bin_to_array(
//     "/run/media/yeti1t3y/Extreme SSD/My_Codes/ArabidopsisPiano/Processed_Data/fft_umap.bin", 
//     "/run/media/yeti1t3y/Extreme SSD/My_Codes/ArabidopsisPiano/Processed_Data/bin_meta.json"
// )

// const min_max_arr = await bin_to_array(
//     "/run/media/yeti1t3y/Extreme SSD/My_Codes/ArabidopsisPiano/Processed_Data/min_max_norm.bin", 
//     "/run/media/yeti1t3y/Extreme SSD/My_Codes/ArabidopsisPiano/Processed_Data/bin_meta.json"
// )

// const min_max_meta = await meta_to_json(
//     "/run/media/yeti1t3y/Extreme SSD/My_Codes/ArabidopsisPiano/Processed_Data/bin_meta.json",
//     "min_max_norm.bin"
// )



export async function plotUMAP(
    umap_bin_path,
    bin_meta_path,
    div_name,
    plot_title,
){
    const count_umap_arr = await bin_to_array(
        umap_bin_path, 
        bin_meta_path,
    )
    const min_max_meta = await meta_to_json(
        "/dat/bin_meta.json",
        "min_max_norm.bin"
    )

    const GeneID = min_max_meta.rownames

    const [count_umap_x , count_umap_y] = split_xy(count_umap_arr)

    // Plot count_umap
    var count_umap_points = {
        x: count_umap_x, 
        y: count_umap_y, 
        mode: "markers", 
        type: "scattergl",
        text: GeneID,
    }

    var count_umap_layout = {
        title: {text: plot_title},
        xaxis: {
            title: {text: "UMAP1"}
        },
        yaxis: {
            title: {text: "UMAP2"}
        }
    }

    Plotly.newPlot(
        div_name,
        [count_umap_points],
        count_umap_layout,
    )
}