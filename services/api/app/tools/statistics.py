"""Real, computed inferential statistics -- the same "verified, not vibes" standard
chemistry.py and symbolic_math.py hold for chemistry and algebra/calculus. Nothing
here asks a model whether a difference "looks significant" or whether two variables
"seem correlated". A t-test is scipy.stats.ttest_ind/ttest_rel; a correlation is
scipy.stats.pearsonr/spearmanr; a chi-square test of independence is
scipy.stats.chi2_contingency; a regression is a real statsmodels.api.OLS fit; a
one-way ANOVA is scipy.stats.f_oneway. Every result carries the real intermediate
quantities (sample means, expected frequencies, standard errors) it was derived
from, so the tutor can show the work instead of asserting a p-value.

This runs IN-PROCESS in the api service, exactly like symbolic_math's SymPy calls
and chemistry.py's own computations -- never a second tool-call round-trip, and
never routed through the sandboxed code_interpreter/sandbox-runner container (that
container's tight memory limit can't fit numpy/scipy/pandas/statsmodels at all; see
ROADMAP.md). Because this runs in-process rather than in that sandbox, every
operation takes real numeric data as structured parameters (lists of numbers, or
paired/grouped lists of numbers) -- never free-text code and never a pandas
DataFrame parameter -- and every sample is capped at MAX_SAMPLE_SIZE points (see
below): these library calls are inherently fast on any dataset a course assignment
would actually hand a student, so the cap exists only to refuse a pathological
input outright, honestly and immediately, rather than accept something unbounded.

What this handles, honestly:
  * t_test -- independent-samples (Student's, pooled variance) and paired t-tests.
  * correlation -- Pearson and Spearman, on paired samples.
  * chi_square -- chi-square test of independence on a contingency table, including
    the expected-frequency table itself (what a student needs to show their work).
  * regression -- simple or multiple OLS (ordinary least squares) regression.
  * anova -- one-way ANOVA across two or more groups.

What it does NOT handle (deliberate, documented gaps -- it says so rather than
guessing):
  * Welch's unequal-variance t-test, non-parametric alternatives to the t-test
    (Mann-Whitney), or repeated-measures/two-way/N-way ANOVA -- one-way only.
  * Post-hoc pairwise tests (Tukey HSD, Bonferroni) after a significant ANOVA --
    it reports that the group means differ somewhere, not which pair.
  * Logistic/Poisson/any non-OLS regression, or regression diagnostics beyond what
    OLS itself reports (no residual plots, no VIF, no outlier detection).
  * Fisher's exact test for small contingency tables -- chi-square only, with an
    honest note when an expected cell is below 5 and the approximation gets shaky.
  * Any multiple-comparisons correction across repeated calls.
"""

import math
from typing import Any

import numpy as np
import statsmodels.api as sm
from scipy import stats

from app.tools.base import Tool

_OPERATIONS = {"t_test", "correlation", "chi_square", "regression", "anova"}

# A "few thousand" points, per the product decision this tool was built under: scipy.
# stats/statsmodels operations at this size run in well under a second (this is what
# makes it safe to compute in-process, in the same one-tool-call round as any other
# tool, with no chained call and no background job) -- so this cap is not a
# performance necessity, it is a deliberate, documented refusal above what any real
# course assignment or homework dataset would ever need, rather than silently
# truncating or accepting something unbounded.
MAX_SAMPLE_SIZE = 5000
MAX_GROUPS = 50
MAX_PREDICTORS = 20
MAX_TABLE_CELLS = 1000


def _fmt(x: float) -> str:
    return f"{float(x):.6g}"


def _clean(name: str, data: Any) -> list[float]:
    """A real, finite list[float] -- or a plain, honest ValueError naming exactly
    what's wrong, the same refusal-over-guessing convention chemistry.py's
    parse_formula uses for a malformed formula."""
    if not isinstance(data, list) or not data:
        raise ValueError(f"'{name}' must be a non-empty list of numbers")
    if len(data) > MAX_SAMPLE_SIZE:
        raise ValueError(
            f"'{name}' has {len(data)} points, over the {MAX_SAMPLE_SIZE}-point cap this tool "
            "accepts per sample -- trim it down, or aggregate/subsample first (this refuses "
            "outright rather than silently truncating or trying to crunch an unbounded input)"
        )
    cleaned: list[float] = []
    for i, v in enumerate(data):
        if isinstance(v, bool) or not isinstance(v, (int, float)):
            raise ValueError(f"'{name}[{i}]' = {v!r} is not a number")
        fv = float(v)
        if not math.isfinite(fv):
            raise ValueError(f"'{name}[{i}]' = {v!r} is not a finite number")
        cleaned.append(fv)
    return cleaned


def _mean(data: list[float]) -> float:
    return float(np.mean(data))


def _sd(data: list[float]) -> float:
    return float(np.std(data, ddof=1)) if len(data) > 1 else 0.0


def _correlation_strength(r: float) -> str:
    a = abs(r)
    if a < 0.1:
        return "negligible"
    if a < 0.3:
        return "weak"
    if a < 0.5:
        return "moderate"
    if a < 0.7:
        return "strong"
    return "very strong"


# ---------------------------------------------------------------------------
# t-test
# ---------------------------------------------------------------------------


def run_t_test(sample1: list, sample2: list, paired: bool = False) -> dict[str, Any]:
    a = _clean("sample1", sample1)
    b = _clean("sample2", sample2)
    if len(a) < 2 or len(b) < 2:
        raise ValueError("a t-test needs at least 2 data points in each sample")
    if paired:
        if len(a) != len(b):
            raise ValueError(
                f"a paired t-test needs equal-length samples (each pair is one subject/measurement); "
                f"got {len(a)} and {len(b)}"
            )
        result = stats.ttest_rel(a, b)
        df = len(a) - 1
        kind = "paired"
    else:
        result = stats.ttest_ind(a, b, equal_var=True)
        df = len(a) + len(b) - 2
        kind = "independent-samples (Student's, pooled variance)"

    t_stat, p_value = float(result.statistic), float(result.pvalue)
    if math.isnan(t_stat) or math.isnan(p_value):
        raise ValueError(
            "this t-test is degenerate for the given data (e.g. zero variance in both samples, "
            "or samples that are identical) -- there's no meaningful difference to test"
        )
    return {
        "kind": kind,
        "t_statistic": t_stat,
        "p_value": p_value,
        "degrees_of_freedom": df,
        "n1": len(a),
        "n2": len(b),
        "mean1": _mean(a),
        "mean2": _mean(b),
        "sd1": _sd(a),
        "sd2": _sd(b),
    }


# ---------------------------------------------------------------------------
# Correlation
# ---------------------------------------------------------------------------


def run_correlation(x: list, y: list, method: str = "pearson") -> dict[str, Any]:
    method = (method or "pearson").strip().lower()
    if method not in ("pearson", "spearman"):
        raise ValueError(f"unknown correlation method '{method}', expected 'pearson' or 'spearman'")
    xs = _clean("x", x)
    ys = _clean("y", y)
    if len(xs) != len(ys):
        raise ValueError(f"'x' and 'y' must be the same length for a correlation; got {len(xs)} and {len(ys)}")
    if len(xs) < 3:
        raise ValueError(
            "a correlation needs at least 3 paired data points to have a meaningful p-value "
            "(1 degree of freedom); got fewer"
        )
    if method == "pearson" and (np.std(xs) == 0 or np.std(ys) == 0):
        raise ValueError(
            "Pearson correlation is undefined when one variable is constant (zero variance) -- "
            "there's no linear relationship to measure"
        )

    if method == "pearson":
        r, p = stats.pearsonr(xs, ys)
    else:
        r, p = stats.spearmanr(xs, ys)
    r, p = float(r), float(p)
    if math.isnan(r) or math.isnan(p):
        raise ValueError(
            "this correlation is degenerate for the given data (e.g. a constant or fully "
            "tied variable) -- there's nothing to measure a relationship against"
        )
    return {"method": method, "r": r, "p_value": p, "n": len(xs)}


# ---------------------------------------------------------------------------
# Chi-square test of independence
# ---------------------------------------------------------------------------


def run_chi_square(table: list) -> dict[str, Any]:
    if not isinstance(table, list) or len(table) < 2:
        raise ValueError("chi_square needs a contingency table with at least 2 rows")
    ncols: int | None = None
    rows: list[list[float]] = []
    for i, row in enumerate(table):
        if not isinstance(row, list) or len(row) < 2:
            raise ValueError(f"contingency table row {i} needs at least 2 columns")
        if ncols is None:
            ncols = len(row)
        elif len(row) != ncols:
            raise ValueError("every row of the contingency table must have the same number of columns")
        rows.append(_clean(f"table row {i}", row))
    assert ncols is not None
    if len(rows) * ncols > MAX_TABLE_CELLS:
        raise ValueError(
            f"a {len(rows)}x{ncols} table has {len(rows) * ncols} cells, over the "
            f"{MAX_TABLE_CELLS}-cell cap this tool accepts"
        )
    arr = np.array(rows)
    if np.any(arr < 0):
        raise ValueError("contingency table counts can't be negative")
    if arr.sum() == 0:
        raise ValueError("this contingency table is all zeros -- there's nothing to test")

    try:
        chi2, p, dof, expected = stats.chi2_contingency(arr)
    except ValueError as exc:
        raise ValueError(
            f"this contingency table can't be tested for independence: {exc} (a row or column "
            "that sums to zero has no expected frequency to compare against)"
        ) from exc

    low_expected = int(np.sum(expected < 5))
    return {
        "chi2": float(chi2),
        "p_value": float(p),
        "dof": int(dof),
        "rows": len(rows),
        "cols": ncols,
        "expected": expected.tolist(),
        "low_expected_count": low_expected,
    }


# ---------------------------------------------------------------------------
# Regression (OLS)
# ---------------------------------------------------------------------------


def run_regression(y: list, x: list | None = None, predictors: list | None = None) -> dict[str, Any]:
    ys = _clean("y", y)
    n = len(ys)
    if np.std(ys) == 0:
        raise ValueError("'y' is constant -- there's no variation for a regression to explain")

    if predictors is not None:
        if not isinstance(predictors, list) or not predictors:
            raise ValueError("'predictors' must be a non-empty list of predictor columns")
        if len(predictors) > MAX_PREDICTORS:
            raise ValueError(
                f"regression supports at most {MAX_PREDICTORS} predictors per call; got {len(predictors)}"
            )
        columns = []
        names = []
        for i, col in enumerate(predictors):
            if not isinstance(col, list):
                raise ValueError(f"predictors[{i}] must be a list of numbers")
            c = _clean(f"predictors[{i}]", col)
            if len(c) != n:
                raise ValueError(
                    f"predictors[{i}] has {len(c)} values but 'y' has {n} -- every predictor must "
                    "be the same length as y"
                )
            columns.append(c)
            names.append(f"x{i + 1}")
        X = np.array(columns).T
    elif x is not None:
        xs = _clean("x", x)
        if len(xs) != n:
            raise ValueError(f"'x' has {len(xs)} values but 'y' has {n} -- they must be the same length")
        X = np.array(xs).reshape(-1, 1)
        names = ["x1"]
    else:
        raise ValueError("regression needs 'x' (single predictor) or 'predictors' (list of predictor columns)")

    p = X.shape[1]
    min_n = p + 2
    if n < min_n:
        raise ValueError(
            f"regression with {p} predictor(s) needs at least {min_n} data points to leave a real "
            f"residual degree of freedom; got {n}"
        )

    X_design = sm.add_constant(X, has_constant="add")
    if np.linalg.matrix_rank(X_design) < X_design.shape[1]:
        raise ValueError(
            "the predictors are perfectly collinear (or one is constant) -- this data doesn't "
            "determine a unique regression line/plane"
        )

    model = sm.OLS(ys, X_design).fit()
    coef_names = ["intercept"] + names
    params, pvalues = list(model.params), list(model.pvalues)
    if any(math.isnan(v) for v in params) or any(math.isnan(v) for v in pvalues):
        raise ValueError(
            "this regression fit is degenerate for the given data (e.g. near-collinear "
            "predictors or too little variation) -- check the data"
        )

    return {
        "names": coef_names,
        "coefficients": dict(zip(coef_names, (float(v) for v in model.params))),
        "std_errors": dict(zip(coef_names, (float(v) for v in model.bse))),
        "t_values": dict(zip(coef_names, (float(v) for v in model.tvalues))),
        "p_values": dict(zip(coef_names, (float(v) for v in model.pvalues))),
        "r_squared": float(model.rsquared),
        "adj_r_squared": float(model.rsquared_adj),
        "f_statistic": float(model.fvalue),
        "f_p_value": float(model.f_pvalue),
        "df_model": int(model.df_model),
        "df_resid": int(model.df_resid),
        "n": n,
    }


# ---------------------------------------------------------------------------
# One-way ANOVA
# ---------------------------------------------------------------------------


def run_anova(groups: list) -> dict[str, Any]:
    if not isinstance(groups, list) or len(groups) < 2:
        raise ValueError("anova needs at least 2 groups")
    if len(groups) > MAX_GROUPS:
        raise ValueError(f"anova supports at most {MAX_GROUPS} groups per call; got {len(groups)}")
    cleaned: list[list[float]] = []
    for i, g in enumerate(groups):
        if not isinstance(g, list):
            raise ValueError(f"group {i + 1} must be a list of numbers")
        c = _clean(f"group {i + 1}", g)
        if len(c) < 2:
            raise ValueError(f"group {i + 1} needs at least 2 data points")
        cleaned.append(c)
    total_n = sum(len(g) for g in cleaned)
    if total_n > MAX_SAMPLE_SIZE:
        raise ValueError(
            f"{total_n} total data points across all groups is over the {MAX_SAMPLE_SIZE}-point "
            "cap this tool accepts per call"
        )

    f_stat, p_value = stats.f_oneway(*cleaned)
    f_stat, p_value = float(f_stat), float(p_value)
    if math.isnan(f_stat) or math.isnan(p_value):
        raise ValueError(
            "this ANOVA is degenerate for the given data (e.g. every value identical across every "
            "group, so there's no variance to partition) -- there's nothing to test"
        )
    return {
        "f_statistic": f_stat,
        "p_value": p_value,
        "k_groups": len(cleaned),
        "df_between": len(cleaned) - 1,
        "df_within": total_n - len(cleaned),
        "group_means": [_mean(g) for g in cleaned],
        "group_sizes": [len(g) for g in cleaned],
        "n_total": total_n,
    }


# ---------------------------------------------------------------------------
# The single tutor-facing entry point
# ---------------------------------------------------------------------------


def solve_statistics(
    operation: str,
    sample1: list | None = None,
    sample2: list | None = None,
    paired: bool = False,
    x: list | None = None,
    y: list | None = None,
    predictors: list | None = None,
    method: str = "pearson",
    table: list | None = None,
    groups: list | None = None,
) -> str:
    if operation not in _OPERATIONS:
        raise ValueError(f"unknown operation '{operation}', expected one of {sorted(_OPERATIONS)}")

    if operation == "t_test":
        if sample1 is None or sample2 is None:
            raise ValueError("t_test needs `sample1` and `sample2`, each a list of numbers")
        r = run_t_test(sample1, sample2, paired=paired)
        sig = "p < 0.05" if r["p_value"] < 0.05 else "p >= 0.05"
        return (
            f"{r['kind'].capitalize()} t-test (scipy.stats), n1={r['n1']} (mean={_fmt(r['mean1'])}, "
            f"sd={_fmt(r['sd1'])}), n2={r['n2']} (mean={_fmt(r['mean2'])}, sd={_fmt(r['sd2'])}).\n"
            f"ANSWER: t({r['degrees_of_freedom']}) = {_fmt(r['t_statistic'])}, p = {_fmt(r['p_value'])} "
            f"({sig} at the conventional alpha=0.05 -- report the actual p-value, alpha is a "
            "convention, not a law).\n"
            "Real t-statistic, p-value, and degrees of freedom from scipy.stats -- not a guess at "
            "'probably significant.'"
        )

    if operation == "correlation":
        if x is None or y is None:
            raise ValueError("correlation needs `x` and `y`, each a list of numbers of the same length")
        r = run_correlation(x, y, method=method)
        return (
            f"{r['method'].capitalize()} correlation (scipy.stats) on {r['n']} paired points.\n"
            f"ANSWER: r = {_fmt(r['r'])} ({_correlation_strength(r['r'])}), p = {_fmt(r['p_value'])}.\n"
            "Real correlation coefficient and p-value from scipy.stats. Correlation, not causation -- "
            "say that plainly if a student reads more into it."
        )

    if operation == "chi_square":
        if table is None:
            raise ValueError("chi_square needs `table`, a contingency table (list of rows, each a list of counts)")
        r = run_chi_square(table)
        expected_str = "; ".join("[" + ", ".join(_fmt(v) for v in row) + "]" for row in r["expected"])
        note = ""
        if r["low_expected_count"] > 0:
            note = (
                f"\nNOTE: {r['low_expected_count']} expected-frequency cell(s) are below 5 -- the "
                "chi-square approximation is less reliable there; a textbook would flag Fisher's "
                "exact test as the more appropriate choice for a table this sparse."
            )
        return (
            f"Chi-square test of independence (scipy.stats.chi2_contingency) on a {r['rows']}x{r['cols']} "
            "table.\n"
            f"Expected frequencies under independence: {expected_str}.\n"
            f"ANSWER: chi2({r['dof']}) = {_fmt(r['chi2'])}, p = {_fmt(r['p_value'])}.{note}\n"
            "Real chi-square statistic and expected-frequency table from scipy.stats, computed from "
            "your observed counts -- not eyeballed."
        )

    if operation == "regression":
        if y is None or (x is None and predictors is None):
            raise ValueError("regression needs `y` and either `x` (single predictor) or `predictors` (multiple)")
        r = run_regression(y, x=x, predictors=predictors)
        coef_lines = [
            f"  {name}: coef = {_fmt(r['coefficients'][name])}, se = {_fmt(r['std_errors'][name])}, "
            f"t = {_fmt(r['t_values'][name])}, p = {_fmt(r['p_values'][name])}"
            for name in r["names"]
        ]
        n_predictors = len(r["names"]) - 1
        return (
            f"OLS regression (statsmodels.api.OLS) on n={r['n']} points, {n_predictors} predictor(s).\n"
            "Real fitted coefficients:\n" + "\n".join(coef_lines) + "\n"
            f"ANSWER: R² = {_fmt(r['r_squared'])}, adjusted R² = {_fmt(r['adj_r_squared'])}, "
            f"F({r['df_model']}, {r['df_resid']}) = {_fmt(r['f_statistic'])}, p = {_fmt(r['f_p_value'])}.\n"
            "Real fitted coefficients, standard errors, and p-values from statsmodels OLS -- not a "
            "slope eyeballed off a scatterplot."
        )

    # anova
    if groups is None:
        raise ValueError("anova needs `groups`, a list of 2+ lists of numbers (one list per group)")
    r = run_anova(groups)
    means_str = ", ".join(
        f"group {i + 1}: n={n}, mean={_fmt(m)}"
        for i, (n, m) in enumerate(zip(r["group_sizes"], r["group_means"]))
    )
    return (
        f"One-way ANOVA (scipy.stats.f_oneway) across {r['k_groups']} groups, N={r['n_total']}.\n"
        f"Group means: {means_str}.\n"
        f"ANSWER: F({r['df_between']}, {r['df_within']}) = {_fmt(r['f_statistic'])}, p = {_fmt(r['p_value'])}.\n"
        "Real F-statistic and p-value from scipy.stats -- a significant F says the group means "
        "differ somewhere, not which pair; a post-hoc test (not run by this tool) would be needed "
        "to say which."
    )


class StatisticsTool(Tool):
    """Inferential statistics' counterpart to chemistry_solver/symbolic_math: the
    p-value is computed, never reasoned toward. t-tests, correlations, and ANOVA run
    through scipy.stats; regression runs a real statsmodels OLS fit; chi-square runs
    scipy's own contingency-table test -- so the tutor can state a t-statistic or an
    R² the same way it states a derivative: because it was calculated."""

    name = "statistics"
    description = (
        "Real computed inferential statistics, never estimated: t_test (independent-samples or "
        "paired, via scipy.stats), correlation (Pearson or Spearman, via scipy.stats), chi_square "
        "(chi-square test of independence on a contingency table, incl. expected frequencies, via "
        "scipy.stats), regression (simple or multiple OLS regression, incl. coefficients/R²/"
        "p-values, via statsmodels), and anova (one-way ANOVA across 2+ groups, via scipy.stats). "
        "Takes real numeric data as lists of numbers, never code or a data file. Use instead of "
        "eyeballing significance, a correlation, or a regression line by hand."
    )
    parameters: dict[str, Any] = {
        "type": "object",
        "properties": {
            "operation": {"type": "string", "enum": sorted(_OPERATIONS)},
            "sample1": {
                "type": "array",
                "items": {"type": "number"},
                "maxItems": MAX_SAMPLE_SIZE,
                "description": "t_test: the first sample's data points.",
            },
            "sample2": {
                "type": "array",
                "items": {"type": "number"},
                "maxItems": MAX_SAMPLE_SIZE,
                "description": "t_test: the second sample's data points.",
            },
            "paired": {
                "type": "boolean",
                "description": "t_test: true for a paired t-test (equal-length, matched samples), false (default) for independent-samples.",
            },
            "x": {
                "type": "array",
                "items": {"type": "number"},
                "maxItems": MAX_SAMPLE_SIZE,
                "description": "correlation: the first variable. regression: the single predictor (omit if using `predictors` instead).",
            },
            "y": {
                "type": "array",
                "items": {"type": "number"},
                "maxItems": MAX_SAMPLE_SIZE,
                "description": "correlation: the second variable. regression: the dependent/outcome variable.",
            },
            "predictors": {
                "type": "array",
                "items": {"type": "array", "items": {"type": "number"}},
                "maxItems": MAX_PREDICTORS,
                "description": (
                    "regression only, for MULTIPLE predictors: a list of predictor columns, each "
                    "the same length as `y`, e.g. [[height_values...], [age_values...]]. Use `x` "
                    "instead for a single predictor."
                ),
            },
            "method": {
                "type": "string",
                "enum": ["pearson", "spearman"],
                "description": "correlation only: 'pearson' (default, linear) or 'spearman' (rank-based, for monotonic/non-linear or ordinal data).",
            },
            "table": {
                "type": "array",
                "items": {"type": "array", "items": {"type": "number"}},
                "description": "chi_square: the contingency table as a list of rows, each row a list of observed counts (at least 2x2).",
            },
            "groups": {
                "type": "array",
                "items": {"type": "array", "items": {"type": "number"}},
                "maxItems": MAX_GROUPS,
                "description": "anova: a list of 2+ groups, each a list of that group's data points.",
            },
        },
        "required": ["operation"],
    }

    async def run(
        self,
        operation: str,
        sample1: list | None = None,
        sample2: list | None = None,
        paired: bool = False,
        x: list | None = None,
        y: list | None = None,
        predictors: list | None = None,
        method: str = "pearson",
        table: list | None = None,
        groups: list | None = None,
    ) -> str:
        try:
            return solve_statistics(
                operation,
                sample1=sample1,
                sample2=sample2,
                paired=bool(paired),
                x=x,
                y=y,
                predictors=predictors,
                method=method or "pearson",
                table=table,
                groups=groups,
            )
        except Exception as exc:
            return f"Error: {exc}"
