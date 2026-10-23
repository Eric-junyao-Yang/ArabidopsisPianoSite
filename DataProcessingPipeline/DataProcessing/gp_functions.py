"""
Shared GP fit / QC helpers. Imported by gp_worker.py for parallelization
Step4_GP_testing.ipynb also imports functions from here to ensure notebook and workers stay in sync.
"""

import gpflow
import tensorflow as tf
import tensorflow_probability as tfp
import numpy as np

tfd = tfp.distributions

# Prior centre for length scale (dimensionless; acts on phase).
# Empirically determined as ~0.4–0.5 from free fits on q≤0.05 genes. See Step4_GP_testing.ipynb for details.
DEFAULT_LENGTH_SCALE = 0.4


def fit_gp_gpflow(x, y, period, best_power, length_scale_initial=DEFAULT_LENGTH_SCALE):
    x = x.reshape(-1, 1).astype(np.float64)
    y = y.reshape(-1, 1).astype(np.float64)
    y_mean = float(np.mean(y))
    mean_fn = gpflow.mean_functions.Constant(c=y_mean)
    y_std = float(np.std(y)) + 1e-9
    var_y = float(np.var(y))

    kernel = gpflow.kernels.Periodic(
        gpflow.kernels.SquaredExponential(
            variance=y_std ** 2,
            lengthscales=length_scale_initial,
        ),
        period=period,
    )
    gpflow.utilities.set_trainable(kernel.period, False)  # Trust Lomb–Scargle period

    kernel.base_kernel.lengthscales.prior = tfd.LogNormal(
        loc=tf.cast(tf.math.log(length_scale_initial), tf.float64),
        scale=tf.cast(0.35, tf.float64),
    )
    kernel.base_kernel.variance.prior = tfd.LogNormal(
        loc=tf.cast(tf.math.log(y_std ** 2), tf.float64),
        scale=tf.cast(1.0, tf.float64),
    )

    model = gpflow.models.GPR(
        data=(x, y),
        kernel=kernel,
        mean_function=mean_fn,
    )

    # Noise prior centred on LS residual variance
    resid_var = max((1.0 - float(best_power)) * var_y, 1e-3 * var_y)

    model.likelihood.variance.assign(resid_var)
    model.likelihood.variance.prior = tfd.LogNormal(
        loc=tf.cast(tf.math.log(resid_var), tf.float64),
        scale=tf.cast(1.0, tf.float64),
    )

    gpflow.optimizers.Scipy().minimize(
        model.training_loss,
        model.trainable_variables,
        options={"maxiter": 500},
    )
    return model


def fit_gp_with_qc(x, y, period, best_power, length_scale_initial=DEFAULT_LENGTH_SCALE):
    """
    Fit GP with detected period from Lomb-Scargle. Also fits with length-scale prior centre
    doubled & halved to measure prior sensitivity of length scale and of the curve shape.

    Note: x/y are NOT phase-folded; the Periodic kernel handles periodicity.
    """
    grid = np.linspace(0, period, 256, endpoint=False).reshape(-1, 1)

    model = fit_gp_gpflow(x, y, period, best_power, length_scale_initial=length_scale_initial)
    model_up = fit_gp_gpflow(x, y, period, best_power, length_scale_initial=length_scale_initial * 2)
    model_down = fit_gp_gpflow(x, y, period, best_power, length_scale_initial=length_scale_initial / 2)

    ls_fit = float(model.kernel.base_kernel.lengthscales.numpy())
    ls_up = float(model_up.kernel.base_kernel.lengthscales.numpy())
    ls_down = float(model_down.kernel.base_kernel.lengthscales.numpy())
    amp = float(model.kernel.base_kernel.variance.numpy())
    noise = float(model.likelihood.variance.numpy())

    # Relative mean delta length scale when prior centre is doubled / halved
    ls_sensitivity_ratio = float(
        ((abs(ls_up - ls_fit) + abs(ls_down - ls_fit)) * 0.5) / (ls_fit + 1e-12)
    )

    # DC-corrected oscillation amplitude of the periodic kernel
    d = np.linspace(0, period, 1000, endpoint=False).reshape(-1, 1)
    k = model.kernel.K(d, np.zeros((1, 1))).numpy().ravel()
    amp_osc = amp - np.mean(k) #Remove the constant DC component

    total_var_model = amp_osc + noise
    noise_frac_model = float(noise / (total_var_model + 1e-9))
    noise_frac_data = float(noise / (float(np.var(y)) + 1e-9))

    mu_default, var = model.predict_f(grid)
    mu_up, _ = model_up.predict_f(grid)
    mu_down, _ = model_down.predict_f(grid)

    mu = mu_default.numpy().ravel()
    mu_u = mu_up.numpy().ravel()
    mu_d = mu_down.numpy().ravel()
    mu_sd = float(np.std(mu)) + 1e-12

    shape_sensitivity = float(np.sqrt(np.mean((mu_u - mu_d) ** 2)) / mu_sd)

    std = np.sqrt(var.numpy().ravel())
    relative_std = float(np.mean(std) / mu_sd)

    qc = {
        "ls_fit": ls_fit,
        "amplitude": float(amp_osc),  # DC-corrected oscillation variance
        "noise": noise,
        "noise_frac_model": noise_frac_model,
        "noise_frac_data": noise_frac_data,
        "ls_sensitivity_ratio": ls_sensitivity_ratio,
        "shape_sensitivity": shape_sensitivity,
        "relative_std": relative_std,
        "mu": mu.astype(np.float32),
        "std": std.astype(np.float32),
    }
    return model, qc


def sample_waveforms_gpflow(model, period, n_samples=20, n_grid=256, seed=123):
    grid = np.linspace(0, period, n_grid, endpoint=False).reshape(-1, 1)

    mu, cov = model.predict_f(grid, full_cov=True)
    mu = mu.numpy().ravel()
    cov = cov.numpy().squeeze()

    # predict_f excludes observation noise (predict_y includes it)
    cov = cov + np.eye(n_grid) * 1e-9
    rng = np.random.default_rng(seed)
    samples = rng.multivariate_normal(mu, cov, size=n_samples)

    return samples, grid.ravel()
