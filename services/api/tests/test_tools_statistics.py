"""Every assertion here is against a hand-checkable or scipy/statsmodels-computed,
textbook-correct value -- the point of the statistics tool is that its numbers are
computed, so a test that only proved "it returned a number" would prove nothing at
all. Where a value isn't easily hand-derived (a Yates-corrected chi-square, a noisy
regression fit), the expected value here was independently computed with the same
real library call scipy/statsmodels ships, not copied from this tool's own output."""

import pytest

from app.tools.statistics import (
    MAX_SAMPLE_SIZE,
    StatisticsTool,
    run_anova,
    run_chi_square,
    run_correlation,
    run_regression,
    run_t_test,
    solve_statistics,
)

# ---------------------------------------------------------------------------
# t-test
# ---------------------------------------------------------------------------


def test_independent_t_test_known_result():
    # Hand-derivable: [1..5] vs [6..10], both sample variance 2.5, pooled SE = 1.0,
    # t = (3 - 8) / 1.0 = -5.0 exactly, df = 5 + 5 - 2 = 8.
    r = run_t_test([1, 2, 3, 4, 5], [6, 7, 8, 9, 10], paired=False)
    assert r["t_statistic"] == pytest.approx(-5.0)
    assert r["degrees_of_freedom"] == 8
    assert r["p_value"] == pytest.approx(0.0010528257933665399, rel=1e-9)
    assert r["mean1"] == pytest.approx(3.0)
    assert r["mean2"] == pytest.approx(8.0)


def test_paired_t_test_known_result():
    before = [10, 12, 9, 11, 13]
    after = [12, 13, 10, 13, 15]
    r = run_t_test(before, after, paired=True)
    assert r["t_statistic"] == pytest.approx(-6.531972647421809, rel=1e-9)
    assert r["degrees_of_freedom"] == 4
    assert r["p_value"] == pytest.approx(0.0028378459267344473, rel=1e-9)


def test_paired_t_test_requires_equal_length_samples():
    with pytest.raises(ValueError, match="equal-length"):
        run_t_test([1, 2, 3], [1, 2], paired=True)


def test_t_test_needs_at_least_two_points_per_sample():
    with pytest.raises(ValueError, match="at least 2 data points"):
        run_t_test([1], [1, 2, 3])


def test_t_test_refuses_zero_variance_identical_samples():
    with pytest.raises(ValueError, match="degenerate"):
        run_t_test([5, 5, 5], [5, 5, 5])


def test_t_test_rejects_non_numeric_data():
    with pytest.raises(ValueError, match="not a number"):
        run_t_test([1, 2, "three"], [1, 2, 3])


def test_t_test_enforces_sample_size_cap():
    huge = list(range(MAX_SAMPLE_SIZE + 1))
    with pytest.raises(ValueError, match="cap"):
        run_t_test(huge, [1, 2, 3])


# ---------------------------------------------------------------------------
# Correlation
# ---------------------------------------------------------------------------


def test_pearson_perfect_positive_correlation():
    r = run_correlation([1, 2, 3, 4, 5], [2, 4, 6, 8, 10], method="pearson")
    assert r["r"] == pytest.approx(1.0)
    assert r["p_value"] == pytest.approx(0.0, abs=1e-12)


def test_pearson_obviously_weak_correlation():
    # A scrambled, non-monotonic relationship -- real scipy value, not close to +-1.
    r = run_correlation([1, 2, 3, 4, 5, 6, 7, 8], [3, 1, 4, 1, 5, 9, 2, 6], method="pearson")
    assert r["r"] == pytest.approx(0.47745526055942267, rel=1e-9)
    assert abs(r["r"]) < 0.6


def test_spearman_perfect_monotonic_nonlinear_relationship():
    # y = x^2 is perfectly monotonic but not linear -- Pearson is strong-but-not-1,
    # Spearman (rank-based) is exactly 1.0, which is exactly the distinction the two
    # methods exist to draw.
    pearson = run_correlation([1, 2, 3, 4, 5], [1, 4, 9, 16, 25], method="pearson")
    spearman = run_correlation([1, 2, 3, 4, 5], [1, 4, 9, 16, 25], method="spearman")
    assert pearson["r"] == pytest.approx(0.981104910251593, rel=1e-9)
    assert spearman["r"] == pytest.approx(1.0)


def test_correlation_requires_matching_lengths():
    with pytest.raises(ValueError, match="same length"):
        run_correlation([1, 2, 3], [1, 2])


def test_correlation_needs_at_least_three_points():
    with pytest.raises(ValueError, match="at least 3"):
        run_correlation([1, 2], [1, 2])


def test_pearson_refuses_constant_variable():
    with pytest.raises(ValueError, match="constant"):
        run_correlation([5, 5, 5, 5], [1, 2, 3, 4])


def test_unknown_correlation_method_raises():
    with pytest.raises(ValueError, match="unknown correlation method"):
        run_correlation([1, 2, 3], [1, 2, 3], method="kendall")


# ---------------------------------------------------------------------------
# Chi-square
# ---------------------------------------------------------------------------


def test_chi_square_exact_independence_gives_zero_statistic():
    # Observed counts exactly match what independence predicts (row/col proportions
    # equal), so chi2 = 0 and p = 1 exactly regardless of the Yates correction.
    r = run_chi_square([[10, 20], [20, 40]])
    assert r["chi2"] == pytest.approx(0.0, abs=1e-9)
    assert r["p_value"] == pytest.approx(1.0)
    assert r["dof"] == 1
    assert r["expected"] == [[10.0, 20.0], [20.0, 40.0]]


def test_chi_square_real_association_matches_scipy():
    # Independently computed via scipy.stats.chi2_contingency([[10, 10], [10, 30]]) --
    # not derived from this tool's own code path.
    r = run_chi_square([[10, 10], [10, 30]])
    assert r["chi2"] == pytest.approx(2.7093749999999996, rel=1e-9)
    assert r["p_value"] == pytest.approx(0.09976006921337979, rel=1e-9)
    assert r["dof"] == 1
    assert r["expected"][0][0] == pytest.approx(6.666666666666667, rel=1e-9)


def test_chi_square_flags_low_expected_frequencies():
    # Row totals 3/23, col totals 4/22, total 26 -> expected[0][0] = 3*4/26 ~= 0.46,
    # well under the conventional 5-count reliability threshold.
    r = run_chi_square([[1, 2], [3, 20]])
    assert r["low_expected_count"] > 0


def test_chi_square_rejects_all_zero_table():
    with pytest.raises(ValueError, match="all zeros"):
        run_chi_square([[0, 0], [0, 0]])


def test_chi_square_rejects_ragged_rows():
    with pytest.raises(ValueError, match="same number of columns"):
        run_chi_square([[1, 2, 3], [4, 5]])


def test_chi_square_needs_at_least_two_rows():
    with pytest.raises(ValueError, match="at least 2 rows"):
        run_chi_square([[1, 2]])


# ---------------------------------------------------------------------------
# Regression
# ---------------------------------------------------------------------------


def test_simple_regression_recovers_exact_true_slope_and_intercept():
    # y = 2x + 3 exactly, no noise -- the fit must land on the true parameters and
    # R^2 = 1.0 exactly.
    x = [1, 2, 3, 4, 5, 6]
    y = [2 * v + 3 for v in x]
    r = run_regression(y, x=x)
    assert r["coefficients"]["intercept"] == pytest.approx(3.0)
    assert r["coefficients"]["x1"] == pytest.approx(2.0)
    assert r["r_squared"] == pytest.approx(1.0)


def test_simple_regression_recovers_approximate_true_slope_with_noise():
    # y = 2x + 3 + small, non-random deterministic perturbation -- the fit should land
    # CLOSE to the true (intercept=3, slope=2), not exactly on it, and the real fitted
    # values here were independently computed via statsmodels, not guessed.
    x = list(range(1, 11))
    noise = [0.5, -0.3, 0.2, -0.1, 0.4, -0.2, 0.1, -0.4, 0.3, -0.5]
    y = [2 * xv + 3 + n for xv, n in zip(x, noise)]
    r = run_regression(y, x=x)
    assert r["coefficients"]["intercept"] == pytest.approx(3.26, rel=1e-6)
    assert r["coefficients"]["x1"] == pytest.approx(1.95272727, rel=1e-6)
    assert r["r_squared"] > 0.99
    # True slope/intercept are recovered close, not exactly, from noisy data.
    assert abs(r["coefficients"]["x1"] - 2.0) < 0.1
    assert abs(r["coefficients"]["intercept"] - 3.0) < 0.5


def test_multiple_regression_recovers_exact_coefficients():
    # y = 1 + 2*x1 + 3*x2 exactly.
    rows = [[1, 1], [2, 1], [3, 2], [4, 2], [5, 3], [6, 4], [7, 3], [8, 5]]
    y = [1 + 2 * r0 + 3 * r1 for r0, r1 in rows]
    predictors = [[row[0] for row in rows], [row[1] for row in rows]]
    r = run_regression(y, predictors=predictors)
    assert r["coefficients"]["intercept"] == pytest.approx(1.0, abs=1e-9)
    assert r["coefficients"]["x1"] == pytest.approx(2.0, abs=1e-9)
    assert r["coefficients"]["x2"] == pytest.approx(3.0, abs=1e-9)
    assert r["r_squared"] == pytest.approx(1.0)


def test_regression_refuses_constant_y():
    with pytest.raises(ValueError, match="constant"):
        run_regression([5, 5, 5, 5, 5], x=[1, 2, 3, 4, 5])


def test_regression_refuses_collinear_predictors():
    predictors = [[1, 2, 3, 4, 5], [2, 4, 6, 8, 10]]  # x2 = 2 * x1 exactly
    with pytest.raises(ValueError, match="collinear"):
        run_regression([1, 2, 3, 4, 5], predictors=predictors)


def test_regression_needs_enough_points_for_residual_degrees_of_freedom():
    with pytest.raises(ValueError, match="residual degree of freedom"):
        run_regression([1, 2], x=[1, 2])


def test_regression_needs_x_or_predictors():
    with pytest.raises(ValueError, match="needs 'x'"):
        run_regression([1, 2, 3, 4])


# ---------------------------------------------------------------------------
# ANOVA
# ---------------------------------------------------------------------------


def test_anova_strongly_different_groups_known_result():
    # Hand-derivable: means 2, 5, 8 (grand mean 5), equal within-group variance 1
    # each -> SSbetween=54, dfbetween=2, MSbetween=27; SSwithin=6, dfwithin=6,
    # MSwithin=1; F = 27/1 = 27.0 exactly.
    r = run_anova([[1, 2, 3], [4, 5, 6], [7, 8, 9]])
    assert r["f_statistic"] == pytest.approx(27.0)
    assert r["df_between"] == 2
    assert r["df_within"] == 6
    assert r["p_value"] == pytest.approx(0.0010000000000000002, rel=1e-9)
    assert r["group_means"] == pytest.approx([2.0, 5.0, 8.0])


def test_anova_identical_group_means_gives_zero_f():
    # All three groups share mean 2 -- between-group variance is exactly 0, so F = 0
    # and p = 1 exactly (this is NOT the degenerate/NaN case: within-group variance
    # is still real and nonzero).
    r = run_anova([[1, 2, 3], [2, 2, 2], [1, 3, 2]])
    assert r["f_statistic"] == pytest.approx(0.0, abs=1e-9)
    assert r["p_value"] == pytest.approx(1.0)


def test_anova_refuses_fewer_than_two_groups():
    with pytest.raises(ValueError, match="at least 2 groups"):
        run_anova([[1, 2, 3]])


def test_anova_refuses_totally_degenerate_input():
    # Every value identical across every group -> zero variance everywhere -> 0/0.
    with pytest.raises(ValueError, match="degenerate"):
        run_anova([[5, 5], [5, 5]])


# ---------------------------------------------------------------------------
# solve_statistics (the tutor-facing formatted-text entry point)
# ---------------------------------------------------------------------------


def test_solve_statistics_unknown_operation_raises():
    with pytest.raises(ValueError, match="unknown operation"):
        solve_statistics("kendall_tau")


def test_solve_statistics_t_test_reports_real_numbers():
    text = solve_statistics("t_test", sample1=[1, 2, 3, 4, 5], sample2=[6, 7, 8, 9, 10])
    assert "t(8) = -5" in text
    assert "scipy.stats" in text


def test_solve_statistics_regression_reports_coefficients_and_r_squared():
    x = [1, 2, 3, 4, 5, 6]
    y = [2 * v + 3 for v in x]
    text = solve_statistics("regression", x=x, y=y)
    assert "coef = 2" in text
    assert "coef = 3" in text
    assert "R² = 1" in text


# ---------------------------------------------------------------------------
# The Tool wrapper
# ---------------------------------------------------------------------------


async def test_tool_run_t_test_for_real():
    tool = StatisticsTool()
    result = await tool.run(operation="t_test", sample1=[1, 2, 3, 4, 5], sample2=[6, 7, 8, 9, 10])
    assert "-5" in result


async def test_tool_run_anova_for_real():
    tool = StatisticsTool()
    result = await tool.run(operation="anova", groups=[[1, 2, 3], [4, 5, 6], [7, 8, 9]])
    assert "27" in result


async def test_tool_run_returns_error_string_not_exception():
    tool = StatisticsTool()
    result = await tool.run(operation="t_test", sample1=[1], sample2=[1, 2, 3])
    assert result.startswith("Error:")


async def test_tool_run_unknown_operation_returns_error_string():
    tool = StatisticsTool()
    result = await tool.run(operation="not_a_real_operation")
    assert result.startswith("Error:")
