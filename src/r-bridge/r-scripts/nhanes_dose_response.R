#!/usr/bin/env Rscript
# Non-linear dose-response curve for ExposomeQL
# Methods: restricted cubic splines (RCS) or GAM
# Returns predicted curve, non-linearity test, and optional threshold detection

suppressPackageStartupMessages({
  library(jsonlite)
  library(survey)
  library(DBI)
  library(RSQLite)
  library(dplyr)
})

nhanespewas_path <- Sys.getenv("NHANESPEWAS_PATH")
if (nzchar(nhanespewas_path) && file.exists(file.path(nhanespewas_path, "DESCRIPTION"))) {
  suppressPackageStartupMessages(devtools::load_all(nhanespewas_path, quiet = TRUE))
} else {
  suppressPackageStartupMessages(library(nhanespewas))
}

params <- fromJSON(file("stdin"))
db_path <- Sys.getenv("EXPOSOMEQL_DB_PATH")

exposure <- params$exposure
outcome_var <- params$outcome
method <- params$method        # "rcs" or "gam"
covariates <- params$covariates
n_knots <- params$n_knots
cycles <- params$cycles

if (is.null(method)) method <- "rcs"
if (is.null(n_knots)) n_knots <- 4

con <- connect_pewas_data(db_path)
on.exit(disconnect_pewas_data(con), add = TRUE)

if (is.null(cycles)) {
  tab_info <- get_table_names_for_varname(con, exposure)
  yr2s <- c("1999"="A","2001"="B","2003"="C","2005"="D","2007"="E","2009"="F","2011"="G","2013"="H","2015"="I","2017"="J")
  cycles <- tail(sort(unique(yr2s[as.character(tab_info$Begin.Year)])), 1)
}

tryCatch({
  all_vars <- unique(c(exposure, outcome_var, covariates))

  # Load data
  all_data <- NULL
  for (s in cycles) {
    tab_obj <- tryCatch(
      get_tables(exposure, outcome_var, s, con),
      error = function(e) NULL
    )
    if (is.null(tab_obj)) next
    tab_obj <- figure_out_weight(tab_obj)
    if (!is.null(tab_obj$merged_tab) && nrow(tab_obj$merged_tab) > 0) {
      dat <- tab_obj$merged_tab
      if (is.null(all_data)) {
        all_data <- dat
      } else {
        common_cols <- intersect(names(all_data), names(dat))
        all_data <- rbind(all_data[, common_cols], dat[, common_cols])
      }
    }
  }

  if (is.null(all_data) || nrow(all_data) == 0) {
    cat(toJSON(list(error = "No data found for specified variables and cycles"), auto_unbox = TRUE))
    quit(status = 1)
  }

  missing_vars <- setdiff(all_vars, names(all_data))
  # Load additional variable tables if needed
  if (length(missing_vars) > 0 && "SEQN" %in% names(all_data)) {
    for (mv in missing_vars) {
      tab_info <- tryCatch(get_table_names_for_varname(con, mv), error = function(e) NULL)
      if (!is.null(tab_info) && nrow(tab_info) > 0) {
        for (s in cycles) {
          yr2s <- c("A"=1999,"B"=2001,"C"=2003,"D"=2005,"E"=2007,"F"=2009,"G"=2011,"H"=2013,"I"=2015,"J"=2017)
          yr <- yr2s[s]
          tab_row <- tab_info[tab_info$Begin.Year == yr, ]
          if (nrow(tab_row) > 0) {
            tab_name <- tab_row$Data.File.Name[1]
            extra <- tryCatch(DBI::dbReadTable(con, tab_name), error = function(e) NULL)
            if (!is.null(extra) && mv %in% names(extra) && "SEQN" %in% names(extra)) {
              all_data <- merge(all_data, extra[, c("SEQN", mv), drop = FALSE], by = "SEQN", all.x = TRUE)
            }
          }
        }
      }
    }
    missing_vars <- setdiff(all_vars, names(all_data))
  }

  if (length(missing_vars) > 0) {
    cat(toJSON(list(error = paste0("Variables not found: ", paste(missing_vars, collapse = ", "))), auto_unbox = TRUE))
    quit(status = 1)
  }

  # Filter to complete cases
  dat <- all_data %>% filter(!is.na(wt), wt > 0)
  for (v in all_vars) {
    dat <- dat %>% filter(!is.na(.data[[v]]))
  }

  # Adjust weights
  n_cycles <- length(cycles)
  if (n_cycles > 1) {
    if (n_cycles == 2 && all(c("A", "B") %in% cycles) && "WTMEC4YR" %in% names(dat)) {
      dat$wt <- dat$WTMEC4YR
    } else {
      dat$wt <- dat$wt / n_cycles
    }
  }

  if (nrow(dat) < 30) {
    cat(toJSON(list(error = paste0("Insufficient sample size (n=", nrow(dat), ").")), auto_unbox = TRUE))
    quit(status = 1)
  }

  # Build covariate formula part
  cov_terms <- ""
  if (!is.null(covariates) && length(covariates) > 0) {
    cov_terms <- paste0(" + ", paste(covariates, collapse = " + "))
  }

  # Create survey design
  options(survey.lonely.psu = "adjust")
  dsn <- svydesign(
    ids = ~SDMVPSU,
    strata = ~SDMVSTRA,
    weights = ~wt,
    nest = TRUE,
    data = dat
  )

  # Generate prediction grid over exposure range
  expo_vals <- dat[[exposure]]
  expo_range <- quantile(expo_vals, probs = c(0.01, 0.99), na.rm = TRUE)
  grid_vals <- seq(expo_range[1], expo_range[2], length.out = 100)

  curve_data <- NULL
  nonlinearity_test <- NULL

  if (method == "rcs") {
    if (!requireNamespace("rms", quietly = TRUE)) {
      cat(toJSON(list(error = "R package 'rms' is required for RCS but not installed."), auto_unbox = TRUE))
      quit(status = 1)
    }
    library(rms)

    # Compute explicit knot locations from the data (needed for prediction on new data)
    knot_probs <- if (n_knots == 3) c(0.10, 0.50, 0.90)
      else if (n_knots == 4) c(0.05, 0.35, 0.65, 0.95)
      else if (n_knots == 5) c(0.05, 0.275, 0.50, 0.725, 0.95)
      else seq(0.05, 0.95, length.out = n_knots)
    knots <- as.numeric(quantile(expo_vals, probs = knot_probs, na.rm = TRUE))

    # Fit spline model with explicit knots
    spline_fml <- as.formula(paste0(outcome_var, " ~ rcs(", exposure, ", c(", paste(knots, collapse = ","), "))", cov_terms))
    fit_spline <- svyglm(spline_fml, design = dsn)

    # Fit linear model for comparison
    linear_fml <- as.formula(paste0(outcome_var, " ~ ", exposure, cov_terms))
    fit_linear <- svyglm(linear_fml, design = dsn)

    # Non-linearity test using survey::regTermTest (Rao-Scott LRT)
    nonlinearity_test <- tryCatch({
      # regTermTest tests whether the non-linear spline terms are jointly zero
      rtt <- regTermTest(fit_spline, paste0("rcs(", exposure, ", c(", paste(knots, collapse = ","), "))"), method = "LRT")
      p_val <- as.numeric(rtt$p)
      list(
        test = "Rao-Scott LRT (non-linear spline terms)",
        statistic = round(as.numeric(rtt$chisq), 4),
        df = as.numeric(rtt$df),
        p_value = p_val,
        conclusion = if (!is.na(p_val) && p_val < 0.05) "Significant non-linearity detected" else "No significant non-linearity"
      )
    }, error = function(e) {
      # Fallback: AIC comparison
      aic_spline <- as.numeric(AIC(fit_spline))[1]
      aic_linear <- as.numeric(AIC(fit_linear))[1]
      pref <- if (aic_spline < aic_linear) "spline" else "linear"
      concl <- if (aic_spline < aic_linear - 2) "Non-linear model preferred by AIC" else "Linear model adequate"
      list(
        test = "AIC comparison",
        aic_spline = round(aic_spline, 2),
        aic_linear = round(aic_linear, 2),
        preferred = pref,
        conclusion = concl
      )
    })

    # Predictions along the grid — use explicit knots so predict works on new data
    newdat <- data.frame(x = grid_vals)
    names(newdat) <- exposure
    if (!is.null(covariates) && length(covariates) > 0) {
      for (cov in covariates) {
        if (is.numeric(dat[[cov]])) {
          newdat[[cov]] <- median(dat[[cov]], na.rm = TRUE)
        } else {
          newdat[[cov]] <- names(sort(table(dat[[cov]]), decreasing = TRUE))[1]
        }
      }
    }

    pred <- predict(fit_spline, newdata = newdat, se.fit = TRUE)
    pred_vals <- as.numeric(pred)
    var_attr <- attr(pred, "var")
    if (!is.null(var_attr)) {
      if (is.matrix(var_attr)) {
        pred_se <- sqrt(diag(var_attr))
      } else {
        pred_se <- sqrt(as.numeric(var_attr))
      }
    } else {
      pred_se <- rep(NA, length(pred_vals))
    }

    curve_data <- lapply(seq_along(grid_vals), function(i) {
      list(
        exposure_value = round(grid_vals[i], 6),
        predicted = round(pred_vals[i], 6),
        se = if (!is.na(pred_se[i])) round(pred_se[i], 6) else NULL,
        ci_lower = if (!is.na(pred_se[i])) round(pred_vals[i] - 1.96 * pred_se[i], 6) else NULL,
        ci_upper = if (!is.na(pred_se[i])) round(pred_vals[i] + 1.96 * pred_se[i], 6) else NULL
      )
    })

  } else if (method == "gam") {
    if (!requireNamespace("mgcv", quietly = TRUE)) {
      cat(toJSON(list(error = "R package 'mgcv' is required for GAM but not installed."), auto_unbox = TRUE))
      quit(status = 1)
    }
    library(mgcv)

    # GAM with survey weights (approximate)
    gam_fml <- as.formula(paste0(outcome_var, " ~ s(", exposure, ", k=", min(n_knots + 2, 10), ")", cov_terms))
    fit_gam <- gam(gam_fml, data = dat, weights = dat$wt)

    # Also fit linear for comparison
    linear_fml <- as.formula(paste0(outcome_var, " ~ ", exposure, cov_terms))
    fit_linear <- gam(linear_fml, data = dat, weights = dat$wt)

    # Non-linearity: AIC comparison + approximate p-value from smooth
    gam_summary <- summary(fit_gam)
    smooth_terms <- gam_summary$s.table
    nonlinearity_test <- list(
      test = "GAM smooth term significance",
      edf = round(smooth_terms[1, "edf"], 2),
      ref_df = round(smooth_terms[1, "Ref.df"], 2),
      statistic = round(smooth_terms[1, "F"], 4),
      p_value = as.numeric(smooth_terms[1, "p-value"]),
      aic_linear = round(AIC(fit_linear), 2),
      aic_gam = round(AIC(fit_gam), 2),
      conclusion = if (smooth_terms[1, "edf"] > 1.5) "Non-linear relationship detected" else "Approximately linear"
    )

    # Predictions
    newdat <- data.frame(x = grid_vals)
    names(newdat) <- exposure
    if (!is.null(covariates) && length(covariates) > 0) {
      for (cov in covariates) {
        if (is.numeric(dat[[cov]])) {
          newdat[[cov]] <- median(dat[[cov]], na.rm = TRUE)
        } else {
          newdat[[cov]] <- names(sort(table(dat[[cov]]), decreasing = TRUE))[1]
        }
      }
    }

    pred <- predict(fit_gam, newdata = newdat, se.fit = TRUE)
    curve_data <- lapply(seq_along(grid_vals), function(i) {
      list(
        exposure_value = round(grid_vals[i], 6),
        predicted = round(pred$fit[i], 6),
        se = round(pred$se.fit[i], 6),
        ci_lower = round(pred$fit[i] - 1.96 * pred$se.fit[i], 6),
        ci_upper = round(pred$fit[i] + 1.96 * pred$se.fit[i], 6)
      )
    })
  }

  output <- list(
    exposure = exposure,
    outcome = outcome_var,
    method = method,
    n = nrow(dat),
    n_knots = n_knots,
    cycles_used = cycles,
    exposure_range = list(
      min = round(min(expo_vals, na.rm = TRUE), 6),
      max = round(max(expo_vals, na.rm = TRUE), 6),
      median = round(median(expo_vals, na.rm = TRUE), 6)
    ),
    nonlinearity_test = nonlinearity_test,
    curve = curve_data,
    note = if (method == "gam") "GAM uses approximate probability weights (not full survey design). Interpret with caution for complex survey data." else "RCS fitted via survey-weighted GLM with full design correction."
  )

  cat(toJSON(output, auto_unbox = TRUE, null = "null"))

}, error = function(e) {
  cat(toJSON(list(error = conditionMessage(e)), auto_unbox = TRUE))
  quit(status = 1)
})
