// Same synthetic gene as the last cell of Step4_GP_testing.ipynb.
// Prints the posterior as JSON. That notebook cell recomputes it in GPflow
// and compares the two vectors.
import { gpSamplerClass } from "./GaussianProcess/GPalgo.js"

const PERIOD = 24
const variance = 1.25
const lengthscale = 0.4
const noise = 0.08
const mean = 8

const sampler = new gpSamplerClass([])
const x = sampler.EXP_HOURS
const y = Float64Array.from(x, (t) => (
    mean
    + 1.1 * Math.sin((2 * Math.PI * t) / PERIOD)
    + 0.25 * Math.sin((4 * Math.PI * t) / PERIOD)
))
const beta = Float64Array.from(y, (value) => value - mean)
const Kyy = sampler.noisyCovariance(x, variance, lengthscale, noise, PERIOD)
const L = sampler.cholesky(Kyy)
const alpha = sampler.solveCholesky(L, beta)
const grid = sampler.predictionGrid(256, PERIOD)
const mu = sampler.posteriorMean(grid, x, alpha, mean, variance, lengthscale, PERIOD)
const std = sampler.posteriorStd(grid, x, L, variance, lengthscale, PERIOD)
const Sigma = sampler.posteriorCov(grid, x, L, variance, lengthscale, PERIOD)
const z = sampler.standardNormalsSeeded(grid.length, 123)
const draw = sampler.drawCurve(mu, Sigma, z)

process.stdout.write(JSON.stringify({
    mu: Array.from(mu),
    std: Array.from(std),
    draw: Array.from(draw),
}))
