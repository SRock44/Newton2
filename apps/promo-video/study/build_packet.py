"""Builds the student's Midterm 2 study packet used by the study-plan film: a dated schedule of
deadlines PLUS real Calculus II content on the techniques of integration, every result
hand-checked. Output: packet.docx.

Checked results (differentiate each answer to verify):
  u-sub      2x cos(x^2) dx                 -> sin(x^2) + C
             x/(x^2+1) dx                   -> (1/2) ln(x^2+1) + C
  parts      x e^x dx   (u=x, dv=e^x dx)    -> e^x (x-1) + C
             ln x dx    (u=ln x, dv=dx)     -> x ln x - x + C
  trig       sin^2 x dx                     -> x/2 - sin(2x)/4 + C
             sin^3 x dx                     -> -cos x + cos^3 x / 3 + C
             sin^2 x cos^3 x dx             -> sin^3 x / 3 - sin^5 x / 5 + C
  trig sub   dx / sqrt(4 - x^2)             -> arcsin(x/2) + C
             dx / (x^2 sqrt(x^2 + 4))       -> -sqrt(x^2+4) / (4x) + C
  partial    (3x+5) / ((x+1)(x+3)) dx       -> ln|x+1| + 2 ln|x+3| + C
"""
from docx import Document
from docx.shared import Pt

doc = Document()
style = doc.styles["Normal"]
style.font.name = "Calibri"
style.font.size = Pt(12)

doc.add_heading("MATH 1220 — Calculus II · Midterm 2 Study Packet", level=1)
doc.add_paragraph("Prof. Alvarez · Spring 2026 · Midterm 2 covers the techniques of integration")

doc.add_heading("Schedule and deadlines", level=2)
for line in [
    "Fri, Feb 6, 2026 — Homework 9 due: integration by parts (problems 1–12). 3% of the course grade.",
    "Wed, Feb 11, 2026 — Quiz 4: trigonometric integrals (in class, 20 minutes). 2% of the course grade.",
    "Fri, Feb 13, 2026 — Homework 10 due: powers of sine and cosine, tangent and secant.",
    "Wed, Feb 18, 2026 — Homework 11 due: trigonometric substitution (the right-triangle method).",
    "Fri, Feb 20, 2026 — Homework 12 due: partial fractions.",
    "Tue, Feb 24, 2026 — Practice midterm due (graded for completion, 2% of the course grade).",
    "Thu, Feb 26, 2026 — Midterm 2 (in class, 75 minutes, 20% of the course grade): substitution, parts, "
    "trigonometric integrals, trigonometric substitution and partial fractions.",
]:
    doc.add_paragraph(line, style="List Bullet")

doc.add_heading("1. u-substitution", level=2)
doc.add_paragraph(
    "Use it when the integrand contains a function and (a constant multiple of) its derivative. "
    "Let u be the inner function, replace u and du, integrate, then substitute back."
)
doc.add_paragraph("Example.  ∫ 2x cos(x²) dx:  u = x², du = 2x dx, so the integral is ∫ cos u du = sin u + C = sin(x²) + C.")
doc.add_paragraph("Example.  ∫ x / (x² + 1) dx:  u = x² + 1, du = 2x dx, so the integral is (1/2) ∫ du/u = (1/2) ln(x² + 1) + C.")

doc.add_heading("2. Integration by parts", level=2)
doc.add_paragraph("∫ u dv = u v − ∫ v du.  Choose u by LIATE: Logarithmic, Inverse trig, Algebraic, Trig, Exponential.")
doc.add_paragraph("Example.  ∫ x e^x dx:  u = x, dv = e^x dx, so du = dx, v = e^x.  Result: e^x (x − 1) + C.")
doc.add_paragraph("Example.  ∫ ln x dx:  u = ln x, dv = dx, so du = dx/x, v = x.  Result: x ln x − x + C.")

doc.add_heading("3. Trigonometric integrals", level=2)
doc.add_paragraph(
    "Powers of sine and cosine. If either power is odd, save one factor, convert the rest with "
    "sin² x + cos² x = 1, and substitute. If both powers are even, use the half-angle identities "
    "sin² x = (1 − cos 2x)/2 and cos² x = (1 + cos 2x)/2."
)
doc.add_paragraph("Example.  ∫ sin² x dx = x/2 − sin(2x)/4 + C   (half-angle identity).")
doc.add_paragraph("Example.  ∫ sin³ x dx = ∫ (1 − cos² x) sin x dx = −cos x + cos³ x / 3 + C   (u = cos x).")
doc.add_paragraph("Example.  ∫ sin² x cos³ x dx = sin³ x / 3 − sin⁵ x / 5 + C   (cosine is odd, u = sin x).")

doc.add_heading("4. Trigonometric substitution (the right-triangle method)", level=2)
doc.add_paragraph(
    "Draw a right triangle to turn a square root into a trig function. For √(a² − x²) let x = a sin θ; "
    "for √(a² + x²) let x = a tan θ; for √(x² − a²) let x = a sec θ. Integrate in θ, then use the "
    "triangle to convert back to x."
)
doc.add_paragraph("Example.  ∫ dx / √(4 − x²):  x = 2 sin θ gives ∫ dθ = θ + C = arcsin(x/2) + C.")
doc.add_paragraph(
    "Example.  ∫ dx / (x² √(x² + 4)):  x = 2 tan θ gives (1/4) ∫ cos θ / sin² θ dθ = −1/(4 sin θ) + C, "
    "and the triangle gives sin θ = x / √(x² + 4), so the result is −√(x² + 4) / (4x) + C."
)

doc.add_heading("5. Partial fractions", level=2)
doc.add_paragraph(
    "For a rational function whose denominator factors, split it into simpler fractions, solve for "
    "the constants by plugging in the roots, and integrate each piece."
)
doc.add_paragraph(
    "Example.  ∫ (3x + 5) / ((x + 1)(x + 3)) dx:  write (3x + 5)/((x+1)(x+3)) = A/(x+1) + B/(x+3). "
    "Then 3x + 5 = A(x + 3) + B(x + 1); x = −1 gives A = 1, x = −3 gives B = 2. "
    "Result: ln|x + 1| + 2 ln|x + 3| + C."
)

doc.save("packet.docx")
print("wrote packet.docx")
