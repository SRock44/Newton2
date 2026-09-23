"""Builds the student's project synopsis (a .docx) for the research film. Its claims are limited
to what paper/experiments.py actually measured; open questions are left open. Output:
Synopsis_SOR_Poisson.docx.
"""
from docx import Document
from docx.shared import Pt

doc = Document()
doc.styles["Normal"].font.name = "Calibri"
doc.styles["Normal"].font.size = Pt(11.5)

doc.add_heading("Project synopsis", level=0)
doc.add_paragraph(
    "Working title: What the optimal relaxation parameter really buys — classical iterative "
    "solvers on the 2D Poisson problem, predicted versus measured."
)
doc.add_paragraph("Author: Priya Nair · Numerical Analysis reading group · target: arXiv (math.NA)")

doc.add_heading("Motivation", level=1)
doc.add_paragraph(
    "Jacobi, Gauss–Seidel and successive over-relaxation (SOR) are the standard first examples of "
    "stationary iterative methods for the discretized Poisson equation. Textbooks quote asymptotic "
    "spectral radii, but rarely compare them with iteration counts measured to a fixed tolerance. "
    "A short, reproducible study of that comparison is a useful teaching reference and a check on "
    "how far asymptotics can be trusted at moderate grid sizes."
)

doc.add_heading("Setting", level=1)
doc.add_paragraph(
    "Model problem −Δu = 1 on the unit square with homogeneous Dirichlet conditions; five-point "
    "stencil on an n × n interior grid, h = 1/(n+1). Methods: Jacobi, Gauss–Seidel, and SOR with "
    "the classical optimal parameter ω* = 2 / (1 + sin(πh)). Stopping rule: relative residual "
    "‖r_k‖₂ / ‖r_0‖₂ < 10⁻⁸ from the zero initial guess. Grids n = 16, 32, 64."
)

doc.add_heading("Research questions", level=1)
for q in (
    "RQ1. Do the iteration counts of Jacobi and Gauss–Seidel grow like n² and those of SOR with "
    "ω* like n?",
    "RQ2. How closely do counts predicted from the spectral radii (ρ_J = cos πh, ρ_GS = ρ_J², "
    "ρ_SOR = ω* − 1) match the measured counts?",
    "RQ3. (Open.) Where SOR's measured count exceeds its prediction, is a transient effect of the "
    "non-normal iteration matrix the explanation? This is a hypothesis, not a result.",
):
    doc.add_paragraph(q, style="List Bullet")

doc.add_heading("Claims the paper should make — and no more", level=1)
for c in (
    "Measured counts for Jacobi and Gauss–Seidel agree with the spectral-radius prediction to within "
    "a few percent, and Gauss–Seidel needs about half the iterations of Jacobi.",
    "Jacobi and Gauss–Seidel counts grow by about 3.8–3.9× per doubling of n; SOR counts by about 2×.",
    "For SOR the measured count is higher than the asymptotic prediction by roughly 30–37% on these "
    "grids. The cause is not established here; the paper should say so plainly.",
):
    doc.add_paragraph(c, style="List Bullet")

doc.add_heading("Planned structure", level=1)
for section in (
    "Introduction and related work (Young; Varga; Golub & Van Loan; LeVeque)",
    "Model problem and methods",
    "Convergence theory: spectral radii and predicted iteration counts",
    "Numerical experiments and results (table, scaling)",
    "Discussion: the SOR gap and its possible explanations (clearly marked as conjecture)",
    "Conclusion and future work (e.g. comparison with conjugate gradients, multigrid)",
):
    doc.add_paragraph(section, style="List Number")

doc.add_heading("Status", level=1)
doc.add_paragraph(
    "Experiments for n = 16, 32, 64 are done and logged in my lab notes. Not done: n = 128, a sweep of "
    "ω around ω*, and any test of the transient hypothesis. Related-work references still to be checked."
)

doc.save("Synopsis_SOR_Poisson.docx")
print("wrote Synopsis_SOR_Poisson.docx")
