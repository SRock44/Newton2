scratch — poisson solvers (NOT clean!!)

TODO: buy printer ink. email Prof. Okafor re seminar slot thurs 3pm

- 2D poisson  -laplace(u) = f  on unit square, 5-pt stencil, dirichlet 0, f = 1, h = 1/(n+1)
- ran jacobi / gauss-seidel / SOR. used red-black ordering so numpy can vectorize it (same rate as lexicographic bc the matrix is consistently ordered — check Young)
- stop when ||r_k||_2 / ||r_0||_2 < 1e-8, u0 = 0

results (iterations, copied from terminal):
n=16  (256 unknowns)   jacobi 1064   gs 543    sor(w*) 65
n=32  (1024 unknowns)  jacobi 4020   gs 2048   sor(w*) 129
n=64  (4096 unknowns)  jacobi 15599  gs 7948   sor(w*) 261
(n=128 too slow in pure numpy — maybe overnight??)

theory bits (lecture + Young):
rho_J = cos(pi h),  rho_GS = rho_J^2,  w* = 2 / (1 + sin(pi h)),  rho_SOR = w* - 1
w*: n=16 -> 1.6895, n=32 -> 1.8264, n=64 -> 1.9078
predicted iters = ln(1e-8) / ln(rho):  jacobi 1073 / 4059 / 15765   gs 537 / 2030 / 7883   sor 50 / 97 / 191
  ^^^ jacobi and gs match nicely. SOR measured is BIGGER than predicted. by ~30%. why??

observations
- jacobi goes x3.8-3.9 every time n doubles => O(n^2). gs same but half as many
- SOR only x2 per doubling => O(n)!!  that's the whole point of w*
- gs ~ jacobi / 2 almost exactly, matches rho_GS = rho_J^2
- sor measured / predicted = 1.30, 1.33, 1.37 — creeping UP with n? not sure
- didn't try other w. w=1.5 and w=1.95 for n=32 would show the sharp minimum at w* (people say the curve is asymmetric — steeper on the left?)
- worry: asymptotic rate maybe isn't reached from u0=0 with f=1. initial error is smooth but SOR iteration matrix is non-normal so there may be a transient hump before the rate kicks in. NOT tested. don't claim it

random
- seminar thurs 3pm: "multigrid for beginners" — go
- groceries: coffee, oat milk, rice, that good bread
- idea: compare with conjugate gradient?? out of scope, put in future work
- refs to chase: Young (thesis 1950 + 1954 paper), Varga "Matrix Iterative Analysis", Golub & Van Loan ch. 11, LeVeque FD book has the model problem
- figure idea: log-log iterations vs n, three lines, slopes 2 / 2 / 1
- rent due friday
