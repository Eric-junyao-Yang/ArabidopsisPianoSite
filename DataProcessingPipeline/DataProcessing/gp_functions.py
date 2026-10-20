"""
Imported to gp_worker.py for parallelization
"""

import gpflow
import tensorflow as tf
import tensorflow_probability as tfp
import numpy as np

tfd = tfp.distributions

def fit_gp_gpflow(x, y, period, ls_init = 0.6): #try folded and non-folded
    """
    Regarding length scale: using the correlation tracking method above, length scale of around 0.6 gave reasonable
    correlation for timepoints with period 48. Length scale works on phase, so 0.6 should be suitable for all periods.
    This also means the peak and trough should have near 0 correlation, which also makes sense np.sqrt(-2/np.log(0.02))=0.7.
    """
    x = x.reshape(-1, 1).astype(np.float64)
    y = y.reshape(-1, 1).astype(np.float64)
    y_mean = np.mean(y).astype(float)
    mean_fn = gpflow.mean_functions.Constant(c=y_mean)
    y_std = np.std(y).astype(float) + 1e-9
    kernel = gpflow.kernels.Periodic(
        gpflow.kernels.SquaredExponential(
            variance = y_std**2,
            lengthscales=ls_init
        ),
        period=period,
    )
    gpflow.utilities.set_trainable(kernel.period, False) #Trust Lomb_Scargle

    kernel.base_kernel.lengthscales.prior = tfd.LogNormal(
        loc = tf.cast(tf.math.log(ls_init), tf.float64),
        scale=tf.cast(0.5, tf.float64)
    )
    kernel.base_kernel.variance.prior = tfd.LogNormal(
        loc=tf.cast(tf.math.log(y_std**2), tf.float64),
        scale=tf.cast(1.0, tf.float64)
    )

    model = gpflow.models.GPR(
        data=(x,y),
        kernel=kernel,
        mean_function=mean_fn,
    )

    model.likelihood.variance.assign(0.2 * y_std**2)
    model.likelihood.variance.prior = tfd.LogNormal(
        loc=tf.cast(tf.math.log(0.1 * y_std**2), tf.float64),
        scale=tf.cast(1.0, tf.float64)
    )

    opt = gpflow.optimizers.Scipy()
    opt.minimize(
        model.training_loss,
        model.trainable_variables,
        options={"maxiter": 500}
    )

    return model

def fit_gp_with_qc(x_folded, y_folded, period, ls_init=0.6):
    """
    The length scale is important in grounding points that doesn't contain enough information to fit a curve nicely, and varying
    the initial length scale will perturbe the fit by quite a bit, this is tracked by fitting the model twice.
    """
    # Primary fit
    model = fit_gp_gpflow(x_folded, y_folded, period, ls_init=ls_init)

    # Perturbed fit
    model_perturbed_up = fit_gp_gpflow(x_folded, y_folded, period, ls_init=ls_init * 2)
    model_perturbed_down = fit_gp_gpflow(x_folded, y_folded, period, ls_init=ls_init / 2)

    # Params
    ls_fit       = float(model.kernel.base_kernel.lengthscales.numpy()) 
    ls_perturbed_up = float(model_perturbed_up.kernel.base_kernel.lengthscales.numpy())
    ls_perturbed_down = float(model_perturbed_down.kernel.base_kernel.lengthscales.numpy())
    amp          = float(model.kernel.base_kernel.variance.numpy())
    noise        = float(model.likelihood.variance.numpy())
    y_std        = float(np.std(y_folded))

    # Sensitivity ratio: how much did ls move when prior center is doubled or halved
    sensitivity_ratio_up = ls_perturbed_up / ls_fit
    sensitivity_ratio_down = ls_perturbed_down / ls_fit

    # Noise fraction
    total_var = amp + noise
    noise_frac = noise / (total_var + 1e-9)

    qc = {
        # Fitted parameters
        "ls_fit":             ls_fit,
        "amplitude":          amp,
        "noise":              noise,

        # QC checks
        "noise_frac":         noise_frac,
        "sensitivity_ratio_up":  sensitivity_ratio_up,
        "sensitivity_ratio_down": sensitivity_ratio_down,
        "prior_sensitive":    
            sensitivity_ratio_up > 1.4 or 
            sensitivity_ratio_up < 0.71 or 
            sensitivity_ratio_down > 1.4 or 
            sensitivity_ratio_down < 0.71,
    }

    return model, qc


def sample_waveforms_gpflow(model, period, n_samples=20, n_grid=256, seed=123):

    grid = np.linspace(0, period, n_grid, endpoint=False).reshape(-1, 1)

    mu, cov = model.predict_f(grid, full_cov=True)
    mu  = mu.numpy().ravel()
    cov = cov.numpy().squeeze()

    # predict_f doesn't include noise (predict_y does)
    
    cov += np.eye(n_grid) * 1e-9 # A diagnal of small values to avoid accidental negatives due to floating point error; diagnal is covariance of point with itself (i.e. vairance)
    rng = np.random.default_rng(seed)
    samples = rng.multivariate_normal(mu, cov, size=n_samples)

    return samples, grid.ravel()