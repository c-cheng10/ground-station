(() => {
  "use strict";

  const MONTHS_PER_YEAR = 12;
  const ANNUAL_LAGS = 3;

  function sum(values) {
    return values.reduce((total, value) => total + value, 0);
  }

  function dot(left, right) {
    return left.reduce((total, value, index) => total + value * right[index], 0);
  }

  // Continued fraction for the regularized incomplete beta function.
  function betaFraction(a, b, x) {
    const nonzero = (value) => Math.abs(value) < 1e-30 ? 1e-30 : value;
    let numerator = 1;
    let inverseDenominator = 1 / nonzero(1 - (a + b) * x / (a + 1));
    let fraction = inverseDenominator;

    for (let order = 1; order <= 150; order += 1) {
      const twice = 2 * order;
      const terms = [
        order * (b - order) * x / ((a + twice - 1) * (a + twice)),
        -(a + order) * (a + b + order) * x / ((a + twice) * (a + twice + 1)),
      ];
      let ratio;
      for (const term of terms) {
        inverseDenominator = 1 / nonzero(1 + term * inverseDenominator);
        numerator = nonzero(1 + term / numerator);
        ratio = numerator * inverseDenominator;
        fraction *= ratio;
      }
      if (Math.abs(ratio - 1) < 1e-13) return fraction;
    }
    throw new Error("Student t calculation did not converge");
  }

  function studentT(degreesOfFreedom) {
    const a = degreesOfFreedom / 2;
    const b = 0.5;
    const initialA = degreesOfFreedom % 2 === 0 ? 1 : 0.5;
    let logBeta = Math.log(initialA === 1 ? 2 : Math.PI);
    for (let step = initialA; step < a; step += 1) {
      logBeta += Math.log(step / (step + b));
    }

    function twoSidedP(statistic) {
      const x = degreesOfFreedom / (degreesOfFreedom + statistic ** 2);
      if (x === 1 || x === 0) return x;
      const scale = Math.exp(a * Math.log(x) + b * Math.log1p(-x) - logBeta);
      const p = x < (a + 1) / (a + b + 2)
        ? scale * betaFraction(a, b, x) / a
        : 1 - scale * betaFraction(b, a, 1 - x) / b;
      return Math.max(0, Math.min(1, p));
    }

    let low = 0;
    let high = 16;
    // The two-sided 5% critical value for every positive integer df lies here.
    for (let index = 0; index < 44; index += 1) {
      const middle = (low + high) / 2;
      if (twoSidedP(middle) > 0.05) low = middle;
      else high = middle;
    }
    return { twoSidedP, criticalValue: (low + high) / 2 };
  }

  function fitTrend(values, time, timeSquared, distribution) {
    const count = values.length;
    const reference = values[0];
    const relative = values.map((value) => value - reference);
    const intercept = sum(relative) / count;
    const slope = dot(time, relative) / timeSquared;
    const started = reference + intercept + slope * time[0];
    const ended = reference + intercept + slope * time[count - 1];
    const scores = relative.map((value, index) => {
      const residual = value - (intercept + slope * time[index]);
      return time[index] * residual;
    });

    // Centred time makes the intercept and slope columns orthogonal, so the
    // slope variance needs only the slope scores rather than the full matrix.
    let covarianceSum = dot(scores, scores);
    for (let lag = 1; lag <= ANNUAL_LAGS; lag += 1) {
      let crossProduct = 0;
      for (let index = lag; index < count; index += 1) {
        crossProduct += scores[index] * scores[index - lag];
      }
      covarianceSum += 2 * (1 - lag / (ANNUAL_LAGS + 1)) * crossProduct;
    }
    const standardError = 10 * Math.sqrt(Math.max(0, covarianceSum) * count / (count - 2)) / timeSquared;
    const decadalSlope = slope * 10;
    const halfWidth = distribution.criticalValue * standardError;

    return {
      slope: decadalSlope,
      ciLow: decadalSlope - halfWidth,
      ciHigh: decadalSlope + halfWidth,
      pValue: standardError === 0
        ? Number(decadalSlope === 0)
        : distribution.twoSidedP(decadalSlope / standardError),
      startValue: started,
      endValue: ended,
    };
  }

  // Abramowitz & Stegun 7.1.26, absolute error below 1.5e-7.
  function erfc(x) {
    const t = 1 / (1 + 0.3275911 * x);
    const poly = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
    return poly * Math.exp(-x * x);
  }

  // shortcut: classic Mann-Kendall assumes independent years; switch to Hamed-Rao if annual autocorrelation is strong.
  function mannKendall(values) {
    const count = values.length;
    let s = 0;
    const slopes = [];
    for (let i = 0; i < count - 1; i += 1) {
      for (let j = i + 1; j < count; j += 1) {
        s += Math.sign(values[j] - values[i]);
        slopes.push((values[j] - values[i]) / (j - i));
      }
    }
    const ties = new Map();
    for (const value of values) ties.set(value, (ties.get(value) || 0) + 1);
    let variance = count * (count - 1) * (2 * count + 5);
    for (const tied of ties.values()) variance -= tied * (tied - 1) * (2 * tied + 5);
    variance /= 18;
    const z = s === 0 || variance === 0 ? 0 : (s - Math.sign(s)) / Math.sqrt(variance);
    slopes.sort((left, right) => left - right);
    const middle = slopes.length / 2;
    const median = slopes.length % 2 ? slopes[Math.floor(middle)] : (slopes[middle - 1] + slopes[middle]) / 2;
    return { senSlope: median * 10, mkPValue: erfc(Math.abs(z) / Math.SQRT2) };
  }

  function calendarMonthMeans(values, firstYear, endYear) {
    const first = firstYear * MONTHS_PER_YEAR;
    const reference = values.slice(first, first + MONTHS_PER_YEAR);
    const means = Array(MONTHS_PER_YEAR).fill(0);
    for (let year = firstYear; year < endYear; year += 1) {
      for (let month = 0; month < MONTHS_PER_YEAR; month += 1) {
        means[month] += values[year * MONTHS_PER_YEAR + month] - reference[month];
      }
    }
    return means.map((total, month) => reference[month] + total / (endYear - firstYear));
  }

  function monthlyResiduals(values, time, timeSquared) {
    const means = calendarMonthMeans(values, 0, time.length);
    const centred = values.map((value, index) => value - means[index % MONTHS_PER_YEAR]);
    const yearTime = (index) => time[Math.floor(index / MONTHS_PER_YEAR)];
    const crossProduct = centred.reduce((total, value, index) => total + value * yearTime(index), 0);
    const slope = crossProduct / (MONTHS_PER_YEAR * timeSquared);
    const residuals = centred.map((value, index) => value - slope * yearTime(index));
    const mean = sum(residuals) / residuals.length;
    return residuals.map((value) => value - mean);
  }

  function pearson(x, y) {
    const xMean = sum(x) / x.length;
    const yMean = sum(y) / y.length;
    const dx = x.map((value) => value - xMean);
    const dy = y.map((value) => value - yMean);
    const denominator = Math.sqrt(dot(dx, dx) * dot(dy, dy));
    return denominator === 0 ? null : Math.max(-1, Math.min(1, dot(dx, dy) / denominator));
  }

  // Row variable in month t against column variable in month t + lag.
  function monthlyCorrelations(residuals, variableIds, lag = 0) {
    return Object.fromEntries(variableIds.map((left) => [left, Object.fromEntries(variableIds.map((right) => [
      right,
      pearson(residuals[left].slice(0, residuals[left].length - lag), residuals[right].slice(lag)),
    ]))]));
  }

  function analyseRegion({ annual, monthly }, years, variableIds, baselineStart, baselineEnd) {
    const count = years.length;
    const baselineFirst = years.indexOf(baselineStart);
    const baselineLast = years.indexOf(baselineEnd);
    if (count < 4 || years.some((year, index) => year !== years[0] + index) ||
        baselineFirst < 0 || baselineLast < baselineFirst) {
      throw new Error("The record does not contain consecutive years and a complete monthly baseline");
    }

    const time = years.map((_, index) => index - (count - 1) / 2);
    const timeSquared = dot(time, time);
    const distribution = studentT(count - 2);
    const series = {};
    const residuals = {};
    for (const id of variableIds) {
      const annualValues = annual[id];
      const monthlyValues = monthly[id];
      if (annualValues?.length !== count || monthlyValues?.length !== count * MONTHS_PER_YEAR ||
          !annualValues.every(Number.isFinite) || !monthlyValues.every(Number.isFinite)) {
        throw new Error(`Incomplete historical record for ${id}`);
      }
      const baseline = calendarMonthMeans(monthlyValues, baselineFirst, baselineLast + 1);
      series[id] = {
        values: annualValues,
        monthlyValues,
        monthlyAnomalies: monthlyValues.map((value, index) => value - baseline[index % MONTHS_PER_YEAR]),
        trend: { ...fitTrend(annualValues, time, timeSquared, distribution), ...mannKendall(annualValues) },
      };
      residuals[id] = monthlyResiduals(monthlyValues, time, timeSquared);
    }
    return { series, residuals };
  }

  window.TrendStatistics = { analyseRegion, mannKendall, monthlyCorrelations };
})();
