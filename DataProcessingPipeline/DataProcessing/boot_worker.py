import os
os.environ.setdefault("OMP_NUM_THREADS", "1")
import numpy as np
from astropy.timeseries import LombScargle

#Constants
FMIN = 1/32
FMAX = 1/6
N_BOOT = 500
SAMPLES_PER_PEAK = 30

#Time Grid
time_grid = np.array(range(2, 50, 3))
n_points = len(time_grid)

#compute grid once
frequency_grid = LombScargle(time_grid, np.zeros(n_points)).autofrequency(
    minimum_frequency=FMIN,
    maximum_frequency=FMAX,
    samples_per_peak=SAMPLES_PER_PEAK
)


def boot_one_gene(args):
    gene_id, y = args
    y = y - np.mean(y)

    #refit model
    ls = LombScargle(time_grid, y)
    power = ls.power(frequency_grid)
    best_idx = np.argmax(power)
    best_frequency = frequency_grid[best_idx]

    #Boot strapping for period confidence
    fitted = ls.model(time_grid, best_frequency)
    residuals = y - fitted
    #inflate residual to account for 4 fitted param in model
    #var = RSS/16 is overestimation, var = RSS/(16-4) is the estimation of true variance
    #c^2 = n / (n-k)
    residuals = residuals * np.sqrt(n_points / (n_points - 4))

    #randomize residuals
    rng = np.random.default_rng()
    boot_periods = np.empty(N_BOOT)

    for i in range(N_BOOT):
        noise_i = rng.choice(residuals, size=n_points, replace=True)
        y_i = fitted + noise_i

        ls_i = LombScargle(time_grid, y_i)
        power_i = ls_i.power(frequency_grid)
        best_freq_i = frequency_grid[power_i.argmax()]
        best_period_i = 1/best_freq_i
        boot_periods[i] = best_period_i

    period_sd = boot_periods.std(ddof=1)
    period_low95, period_high95 = np.percentile(boot_periods, [2.5, 97.5])
    boot_log_periods = np.log(boot_periods)
    log_period_sd = boot_log_periods.std(ddof=1)

    return {"GeneID": gene_id, "period_sd":period_sd, "period_low95":period_low95, "period_high95":period_high95, "log_period_sd":log_period_sd}