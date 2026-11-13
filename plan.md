# Client-side GP sampling

The periodic GP is an exact regression on 16 shared time points. Ship four fitted scalars per gene and draw the posterior in the browser for both the plot and the audio morph.

## Save

Per gene, float32: `lengthscale`, `variance`, `noise`, `mean` (`mean_function.c` after optimization). Inputs `2, 5, …, 47` and period `24` stay global. Expression `y` stays in `VST.bin`. Do not ship `mu`, `std`, or posterior draws.

3286 genes × 16 bytes ≈ 53 KB, against about 40 MB for 10 curves plus `mu` and `std` on a 256-point grid.

## To do

- [x] Pipeline: persist the four hyperparameters from the fitted model. The export cell writes `gp_params.bin` (genes × 4 float32, same order as its meta) and replaces the `waveforms.bin` entry in `bin_meta.json`.
- [ ] Re-run the fit and export cells in `Step4_GP_testing.ipynb` so `Sampled_dat.json` and `gp_params.bin` match the new fields.
- [ ] JS kernel: GPflow `Periodic(SquaredExponential)` on the `(sin, cos)` map of `2π t / 24`, so `k = σ² exp(−2 sin²(π Δt / 24) / ℓ²)`.
- [ ] Plot: for the selected gene, posterior mean and pointwise standard deviation on 256 points from those four numbers plus the VST row. Replace the `SharedArrayBuffer` waveform read in `GPplot.js`.
- [ ] Audio: pathwise conditioning in the step-seq worklet. Prior is the Bessel harmonic series of this kernel (about 48 harmonics). On note-on, draw weights and solve the 16×16 system. Each sample is the harmonic sum plus the 16 kernel corrections.
- [ ] Morph by crossfading the harmonic weights, with speed from the q-value. An amplitude mix of two stored curves is not a posterior path.
- [ ] Check one gene against `sample_waveforms_gpflow`: mean, marginal standard deviation, and a few draws.
