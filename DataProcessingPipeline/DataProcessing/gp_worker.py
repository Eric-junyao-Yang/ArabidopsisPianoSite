"""
Stand alone .py file needed for parallelization
"""

def fit_single_gene(args):
    import gpflow
    import tensorflow as tf
    import tensorflow_probability as tfp
    import numpy as np
    from gp_functions import fit_gp_with_qc, sample_waveforms_gpflow
    import os

    os.environ["CUDA_VISIBLE_DEVICES"] = "" #Skip GPU and use CPU parallization

    GeneID, dat, lc_period, lc_phase, fap, ls_init = args
    row = {}

    try:
        model, qc = fit_gp_with_qc(np.arange(2, 50, 3), dat, lc_period, ls_init)
        samples, grid = sample_waveforms_gpflow(model, lc_period, n_samples=10, n_grid=256, seed=123)
        mu, var = model.predict_f(np.array(grid).reshape(-1,1))

        mu = mu.numpy().ravel().astype(np.float32)
        std = np.sqrt(var.numpy().ravel()).astype(np.float32)

        row['GeneID'] = GeneID
        for i in range(samples.shape[0]):
            row[f'sample_{i+1}'] = samples[i].astype(np.float32)
        row['mu'] = mu
        row['std'] = std
        row['period'] = float(lc_period)
        row['phase'] = float(lc_phase)
        row['fap'] = float(fap)
        row['ls_fit'] = qc['ls_fit']
        row['amplitude'] = qc['amplitude']
        row['noise'] = qc['noise']
        row['noise_frac'] = qc['noise_frac']
        row['sensitivity_ratio_up'] = qc['sensitivity_ratio_up']
        row['sensitivity_ratio_down'] = qc['sensitivity_ratio_down']
        row['success'] = True

        return row

    except Exception as e:
        row['GeneID'] = GeneID
        row['success'] = False
        row['error'] = str(e)
        return row