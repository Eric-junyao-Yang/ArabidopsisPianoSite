export class gpSamplerClass{
    constructor(gp_params_arr, VST_lookup){
        this.gp_params_lookup = new Map(gp_params_arr.map((v) => [v.GeneID, v]))
        this.VST_lookup = VST_lookup
        this.PERIOD = 24
        this.EXP_HOURS = Array.from({ length: 16 }, (_, i) => 2 + 3 * i)
        this.grid = this.predictionGrid(256, this.PERIOD)
        this.mu = 0
        this.std = 0
        this.Sigma = 0
    }

    periodicKernel(dt, variance, length_scale, period = this.PERIOD){
        //perfectly matches periodic(squaredExponential)'s result in GPflow
        const s = Math.sin((Math.PI * dt) / period)
        return variance * Math.exp(-0.5 * (s * s) / (length_scale * length_scale))
    }

    cholesky(A) {
        const n = A.length
        const L = Array.from({ length: n }, () => new Float64Array(n))
        for (let i = 0; i < n; i++) {
            for (let j = 0; j <= i; j++) {
                let sum = A[i][j]
                for (let k = 0; k < j; k++) sum -= L[i][k] * L[j][k]
                if (i === j) L[i][j] = Math.sqrt(sum)
                else L[i][j] = sum / L[j][j]
            }
        }
    return L
    }

    kernelMatrix(x, variance, lengthscale, period = this.PERIOD) {
        const n = x.length
        const K = Array.from({ length: n }, () => new Float64Array(n))
        for (let i = 0; i < n; i++) {
            K[i][i] = variance
            for (let j = 0; j < i; j++) {
                const kij = this.periodicKernel(x[i] - x[j], variance, lengthscale, period)
                K[i][j] = kij
                K[j][i] = kij
            }
        }
        return K
    }

    noisyCovariance(x, variance, lengthscale, noise, period = this.PERIOD) {
        const Kyy = this.kernelMatrix(x, variance, lengthscale, period)
        for (let i = 0; i < Kyy.length; i++) Kyy[i][i] += noise
        return Kyy
    }

    solveLower(L, b) {
        const n = b.length
        const c = new Float64Array(n)
        for (let i = 0; i < n; i++) {
            let sum = b[i]
            for (let k = 0; k < i; k++) sum -= L[i][k] * c[k]
            c[i] = sum / L[i][i]
        }
        return c
    }
    solveUpper(L, c) {
        const n = c.length
        const alpha = new Float64Array(n)
        for (let i = n - 1; i >= 0; i--) {
            let sum = c[i]
            for (let k = i + 1; k < n; k++) sum -= L[k][i] * alpha[k]
            alpha[i] = sum / L[i][i]
        }
        return alpha
    }
    solveCholesky(L, beta) {
        return this.solveUpper(L, this.solveLower(L, beta))
    }

    predictionGrid(nGrid = 256, period = this.PERIOD) {
        const grid = new Float64Array(nGrid)
        for (let j = 0; j < nGrid; j++) grid[j] = (j * period) / nGrid
        return grid
    }
    posteriorMean(grid, expHours = this.EXP_HOURS, alpha, mean, variance, lengthscale, period = this.PERIOD) {
        const mu = new Float64Array(grid.length)
        for (let j = 0; j < grid.length; j++) {
            let sum = mean
            for (let i = 0; i < expHours.length; i++) {
                sum += alpha[i] * this.periodicKernel(grid[j] - expHours[i], variance, lengthscale, period)
                //note here the periodicKernel is before noise is added, so alpha is calucated with noise, but postMean is calculated without
            }
            mu[j] = sum
        }
        return mu
    }
    posteriorStd(grid, expHours = this.EXP_HOURS, L, variance, lengthscale, period = this.PERIOD) {
        const std = new Float64Array(grid.length)
        for (let j = 0; j < grid.length; j++) {
            const kStar = new Float64Array(expHours.length)
            for (let i = 0; i < expHours.length; i++) {
                kStar[i] = this.periodicKernel(grid[j] - expHours[i], variance, lengthscale, period)
            }
            const v = this.solveLower(L, kStar)
            let explained = 0
            for (let i = 0; i < v.length; i++) explained += v[i] * v[i]
            std[j] = Math.sqrt(Math.max(0, variance - explained))
        }
        return std
    }
    dot(a, b) {
        let sum = 0
        for (let i = 0; i < a.length; i++) sum += a[i] * b[i]
        return sum
    }

    posteriorCov(grid, expHours = this.EXP_HOURS, L, variance, lengthscale, period = this.PERIOD) {
        const m = grid.length
        // Array.from, not grid.map: Float64Array.map stores numbers, not the solved vectors.
        const V = Array.from(grid, (t) => {
            const kStar = Float64Array.from(expHours, (x) =>
                this.periodicKernel(t - x, variance, lengthscale, period)
            )
            return this.solveLower(L, kStar)
        })
        const Sigma = Array.from({ length: m }, () => new Float64Array(m))
        for (let i = 0; i < m; i++) {
            Sigma[i][i] = variance - this.dot(V[i], V[i])
            for (let j = 0; j < i; j++) {
                const cij = this.periodicKernel(grid[i] - grid[j], variance, lengthscale, period) - this.dot(V[i], V[j])
                Sigma[i][j] = cij
                Sigma[j][i] = cij
            }
        }
        return Sigma
    }
    drawCurve(mu, Sigma, z, jitter = 1e-9) {
        const S = Sigma.map((row) => Float64Array.from(row))
        for (let i = 0; i < S.length; i++) S[i][i] += jitter
        const Lstar = this.cholesky(S)
        const sample = new Float64Array(mu.length)
        for (let i = 0; i < mu.length; i++) {
            let value = mu[i]
            for (let p = 0; p <= i; p++) value += Lstar[i][p] * z[p]
            sample[i] = value
        }
        return sample
    }

    standardNormalsSeeded(n, seed) {
        // for comparing with GPflow only.
        let state = seed >>> 0
        const nextU = () => {
            state = (Math.imul(1664525, state) + 1013904223) >>> 0
            return state / 4294967296
        }
        const z = new Float64Array(n)
        for (let i = 0; i < n; i += 2) {
            const u1 = Math.max(nextU(), 1e-12)
            const u2 = nextU()
            const r = Math.sqrt(-2 * Math.log(u1))
            const theta = 2 * Math.PI * u2
            z[i] = r * Math.cos(theta)
            if (i + 1 < n) z[i + 1] = r * Math.sin(theta)
        }
        return z
    }

    standardNormals(n) {
        // for real use
        const z = new Float64Array(n)
        for (let i = 0; i < n; i += 2) {
            const u1 = Math.max(Math.random(), 1e-12)
            const u2 = Math.random()
            const r = Math.sqrt(-2 * Math.log(u1))
            const theta = 2 * Math.PI * u2
            z[i] = r * Math.cos(theta)
            if (i + 1 < n) z[i + 1] = r * Math.sin(theta)
        }
        return z
    }

    updateMuStdSigma(GeneID){
        const row = this.VST_lookup.get(GeneID)
        const param = this.gp_params_lookup.get(GeneID)
        const lengthscale = param.lengthscale
        const mean = param.mean
        const variance = param.variance
        const noise = param.noise

        // VST rows are objects {GeneID, LD_ZT02, ...}; take numeric cols in EXP_HOURS order.
        const y = Float64Array.from(this.EXP_HOURS, (_, i) => {
            const zt = String(this.EXP_HOURS[i]).padStart(2, "0")
            return row[`LD_ZT${zt}`]
        })
        
        const beta = Float64Array.from(y, (v) => v - mean)
        const Kyy = this.noisyCovariance(this.EXP_HOURS, variance, lengthscale, noise, this.PERIOD)
        const L = this.cholesky(Kyy)
        const alpha = this.solveCholesky(L, beta)

        this.mu = this.posteriorMean(this.grid, this.EXP_HOURS, alpha, mean, variance, lengthscale, this.PERIOD)
        this.std = this.posteriorStd(this.grid, this.EXP_HOURS, L, variance, lengthscale, this.PERIOD)
        this.Sigma = this.posteriorCov(this.grid, this.EXP_HOURS, L, variance, lengthscale, this.PERIOD)
    }

    drawPosterior(){
        const z = this.standardNormals(this.grid.length)
        return draw = this.drawCurve(this.mu, this.Sigma, z)
    }
}