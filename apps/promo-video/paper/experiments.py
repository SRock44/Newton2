"""Real numerical experiments behind the research film's 'lab notes': classical iterative solvers
on the 2D Poisson problem  -Δu = f  on the unit square (5-point stencil, Dirichlet boundary).
Everything the student's notes quote comes from running this script; nothing is invented.

  Jacobi:        rho_J  = cos(pi h),           h = 1/(n+1)
  Gauss-Seidel:  rho_GS = rho_J^2
  SOR (omega*):  omega* = 2 / (1 + sin(pi h)), rho_SOR = omega* - 1
Iterations to reduce the relative residual ||r_k||_2 / ||r_0||_2 below 1e-8, f == 1, u_0 == 0.
"""
import json
import math
import time

import numpy as np

TOL = 1e-8


def residual_norm(u, f, h2):
    r = f + (u[:-2, 1:-1] + u[2:, 1:-1] + u[1:-1, :-2] + u[1:-1, 2:] - 4 * u[1:-1, 1:-1]) / h2
    return float(np.linalg.norm(r))


def jacobi(n, f):
    h2 = (1.0 / (n + 1)) ** 2
    u = np.zeros((n + 2, n + 2))
    r0 = residual_norm(u, f, h2)
    k = 0
    while True:
        k += 1
        new = u.copy()
        new[1:-1, 1:-1] = 0.25 * (u[:-2, 1:-1] + u[2:, 1:-1] + u[1:-1, :-2] + u[1:-1, 2:] + h2 * f)
        u = new
        if residual_norm(u, f, h2) / r0 < TOL:
            return k


def red_black_sweep(u, f, h2, omega):
    """One (red-black ordered) Gauss-Seidel/SOR sweep; vectorized, same convergence rate as
    lexicographic ordering for this problem (consistently ordered matrix)."""
    n = u.shape[0] - 2
    ii, jj = np.meshgrid(np.arange(1, n + 1), np.arange(1, n + 1), indexing="ij")
    for colour in (0, 1):
        mask = ((ii + jj) % 2) == colour
        gs = 0.25 * (u[:-2, 1:-1] + u[2:, 1:-1] + u[1:-1, :-2] + u[1:-1, 2:] + h2 * f)
        inner = u[1:-1, 1:-1]
        inner[mask] = (1 - omega) * inner[mask] + omega * gs[mask]


def sor(n, f, omega):
    h2 = (1.0 / (n + 1)) ** 2
    u = np.zeros((n + 2, n + 2))
    r0 = residual_norm(u, f, h2)
    k = 0
    while True:
        k += 1
        red_black_sweep(u, f, h2, omega)
        if residual_norm(u, f, h2) / r0 < TOL:
            return k


out = []
for n in (16, 32, 64):
    h = 1.0 / (n + 1)
    rho_j = math.cos(math.pi * h)
    w_opt = 2 / (1 + math.sin(math.pi * h))
    f = np.ones((n, n))
    t0 = time.time()
    kj = jacobi(n, f)
    kg = sor(n, f, 1.0)
    ks = sor(n, f, w_opt)
    out.append(
        dict(
            n=n,
            unknowns=n * n,
            rho_jacobi=round(rho_j, 5),
            rho_gs=round(rho_j**2, 5),
            omega_opt=round(w_opt, 4),
            rho_sor=round(w_opt - 1, 5),
            iters_jacobi=kj,
            iters_gs=kg,
            iters_sor=ks,
            predicted_jacobi=math.ceil(math.log(TOL) / math.log(rho_j)),
            predicted_gs=math.ceil(math.log(TOL) / math.log(rho_j**2)),
            predicted_sor=math.ceil(math.log(TOL) / math.log(w_opt - 1)),
            seconds=round(time.time() - t0, 1),
        )
    )
    print(out[-1], flush=True)
json.dump(out, open("experiments.json", "w"), indent=1)
