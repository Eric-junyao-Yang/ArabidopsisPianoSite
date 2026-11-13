"""
Standalone worker for multiprocessing.Pool (spawn).
"""

def fit_single_gene(args):
    import os
    os.environ["CUDA_VISIBLE_DEVICES"] = ""  # CPU parallelization

    import numpy as np
    from gp_functions import fit_gp_with_qc

    (
        GeneID,
        dat,
        ls_init,
    ) = args

    row = {"GeneID": GeneID}

    try:
        model, qc = fit_gp_with_qc(
            np.arange(2, 50, 3), dat, ls_init
        )

        # Posterior draws happen in the browser. Keep the fitted scalars only.
        row["lengthscale"] = float(model.kernel.base_kernel.lengthscales.numpy())
        row["variance"] = float(model.kernel.base_kernel.variance.numpy())
        row["noise"] = float(model.likelihood.variance.numpy())
        row["mean"] = float(model.mean_function.c.numpy())
        row["relative_std"] = float(qc["relative_std"])
        row["shape_sensitivity"] = float(qc["shape_sensitivity"])
        row["success"] = True
        return row

    except Exception as e:
        row["success"] = False
        row["error"] = str(e)
        return row
