"""
Standalone worker for multiprocessing.Pool (spawn).
"""

def fit_single_gene(args):
    import os
    os.environ["CUDA_VISIBLE_DEVICES"] = ""  # CPU parallelization

    import numpy as np
    from gp_functions import fit_gp_with_qc, sample_waveforms_gpflow

    (
        GeneID,
        dat,
        lc_period,
        lc_phase,
        best_power,
        qval,
        log_period_sd,
        period_sd,
        period_low95,
        period_high95,
        log_TPM,
        ls_init,
    ) = args

    row = {"GeneID": GeneID}

    try:
        model, qc = fit_gp_with_qc(
            np.arange(2, 50, 3), dat, lc_period, best_power, ls_init
        )
        samples, _grid = sample_waveforms_gpflow(
            model, lc_period, n_samples=10, n_grid=256, seed=123
        )

        for i in range(samples.shape[0]):
            row[f"sample_{i + 1}"] = samples[i].astype(np.float32)

        row["mu"] = qc["mu"]
        row["std"] = qc["std"]
        row["period"] = float(lc_period)
        row["phase"] = float(lc_phase)
        row["qval"] = float(qval)
        row["best_power"] = float(best_power)
        row["log_period_sd"] = float(log_period_sd)
        row["period_sd"] = float(period_sd)
        row["period_low95"] = float(period_low95)
        row["period_high95"] = float(period_high95)
        row["log_TPM"] = float(log_TPM)
        row["ls_fit"] = float(qc["ls_fit"])
        row["amplitude"] = float(qc["amplitude"])
        row["noise"] = float(qc["noise"])
        row["noise_frac_data"] = float(qc["noise_frac_data"])
        row["relative_std"] = float(qc["relative_std"])
        row["shape_sensitivity"] = float(qc["shape_sensitivity"])
        row["ls_sensitivity_ratio"] = float(qc["ls_sensitivity_ratio"])
        row["success"] = True
        return row

    except Exception as e:
        row["success"] = False
        row["error"] = str(e)
        return row
