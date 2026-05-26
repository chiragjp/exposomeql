#!/usr/bin/env Rscript
# Regression model with a derived phenotype as the outcome.
#
# The outcome is read from a handle CSV (written by nhanes_phenotype_derive.py),
# predictors are loaded from the underlying NHANES SQLite database. The CSV
# format is source-agnostic: it must contain an id column + a 'value' column;
# survey-design columns (psu/strata/weight) are optional. When absent, a
# non-survey glm() is fit instead of svyglm() so the same script handles
# future non-NHANES cohort handles.

suppressPackageStartupMessages({
  library(jsonlite)
  library(survey)
  library(DBI)
  library(RSQLite)
  library(dplyr)
  library(broom)
})

params <- if (exists("POOL_PARAMS", envir = globalenv())) get("POOL_PARAMS", envir = globalenv()) else fromJSON(file("stdin"))
db_path <- Sys.getenv("EXPOSOMEQL_DB_PATH")

handle_csv     <- params$phenotype_handle_csv
outcome_name   <- params$outcome_name %||% "derived_phenotype"
predictors     <- params$predictors
model_type     <- params$model_type %||% "linear"
phenotype_type <- params$phenotype_type %||% "continuous"
spline_vars    <- params$splines
interactions   <- params$interactions
id_col         <- params$id_column     %||% "SEQN"
wt_col         <- params$weight_column %||% "wt_pooled"
psu_col        <- params$psu_column    %||% "SDMVPSU"
str_col        <- params$strata_column %||% "SDMVSTRA"
has_survey     <- isTRUE(params$has_survey_design)

`%||%` <- function(a, b) if (is.null(a) || (is.character(a) && !nzchar(a))) b else a

# Auto-pick logistic for binary handles unless the caller explicitly overrode
if (phenotype_type == "binary" && model_type == "linear") {
  model_type <- "logistic"
}

if (is.null(handle_csv) || !file.exists(handle_csv)) {
  cat(toJSON(list(error = paste0("phenotype handle CSV not found: ", handle_csv %||% "<null>")), auto_unbox = TRUE))
  quit(status = 1)
}

con <- dbConnect(SQLite(), db_path)

tryCatch({
  all_data <- read.csv(handle_csv)
  # Promote 'value' to the outcome's reported name (for formula readability).
  names(all_data)[names(all_data) == "value"] <- outcome_name
  has_cycle <- "cycle" %in% names(all_data)
  cycles <- if (has_cycle) unique(all_data$cycle) else character(0)

  yr2s <- c("A"=1999,"B"=2001,"C"=2003,"D"=2005,"E"=2007,"F"=2009,
            "G"=2011,"H"=2013,"I"=2015,"J"=2017)

  # Load predictors that aren't already on the handle CSV. NHANES specifically:
  # use the variable_names_epcf catalog. Future cohort drivers can short-circuit
  # this loop by stuffing all predictors into the handle CSV up front.
  missing_vars <- setdiff(predictors, names(all_data))
  if (length(missing_vars) > 0 && id_col %in% names(all_data)) {
    for (mv in missing_vars) {
      cat_info <- tryCatch(
        dbGetQuery(con,
          'SELECT "Data.File.Name" AS f, "Begin.Year" AS y FROM variable_names_epcf WHERE "Variable.Name"=?',
          params = list(mv)),
        error = function(e) NULL
      )
      if (is.null(cat_info) || nrow(cat_info) == 0) next
      cat_info <- cat_info[!grepl("^P_", cat_info$f), ]
      if (nrow(cat_info) == 0) next

      # Build a cycle-tagged stack for this predictor so the merge stays
      # unambiguous across multi-cycle handle data.
      extra_stacked <- NULL
      if (has_cycle && length(cycles) > 0) {
        for (s in cycles) {
          yr <- yr2s[s]
          row <- cat_info[!is.na(cat_info$y) & cat_info$y == yr, ]
          if (nrow(row) == 0) next
          tab <- tryCatch(dbReadTable(con, row$f[1]), error = function(e) NULL)
          if (is.null(tab) || !(mv %in% names(tab)) || !(id_col %in% names(tab))) next
          tab_sub <- tab[, c(id_col, mv)]
          tab_sub$cycle <- s
          extra_stacked <- rbind(extra_stacked, tab_sub)
        }
        if (!is.null(extra_stacked)) {
          all_data <- merge(all_data, extra_stacked, by = c(id_col, "cycle"), all.x = TRUE)
        }
      } else {
        # Single-cycle handle or non-NHANES source — fall back to id-only merge
        tab <- tryCatch(dbReadTable(con, cat_info$f[1]), error = function(e) NULL)
        if (!is.null(tab) && mv %in% names(tab) && id_col %in% names(tab)) {
          all_data <- merge(all_data, tab[, c(id_col, mv)], by = id_col, all.x = TRUE)
        }
      }
    }
  }

  still_missing <- setdiff(predictors, names(all_data))
  if (length(still_missing) > 0) {
    cat(toJSON(list(error = paste0("Predictor variables not found: ",
                                    paste(still_missing, collapse = ", "))),
               auto_unbox = TRUE))
    quit(status = 1)
  }

  # Filter complete cases (outcome + predictors + weight when survey-weighted)
  dat <- all_data[!is.na(all_data[[outcome_name]]), ]
  for (v in predictors) dat <- dat[!is.na(dat[[v]]), ]
  if (has_survey && wt_col %in% names(dat)) {
    dat <- dat[!is.na(dat[[wt_col]]) & dat[[wt_col]] > 0, ]
  }

  if (nrow(dat) < 30) {
    cat(toJSON(list(error = paste0("Insufficient sample size (n=", nrow(dat), ")")), auto_unbox = TRUE))
    quit(status = 1)
  }

  # Detect categorical predictors (≤10 unique levels or character/factor)
  for (p in predictors) {
    vals <- dat[[p]]
    if (is.character(vals) || is.factor(vals) ||
        length(unique(vals[!is.na(vals)])) <= 10) {
      dat[[p]] <- as.factor(dat[[p]])
    }
  }

  if (model_type == "logistic") {
    out_vals <- unique(dat[[outcome_name]])
    if (length(out_vals) > 2) {
      cat(toJSON(list(error = paste0("Logistic regression requires binary outcome; found ",
                                      length(out_vals), " unique values.")),
                 auto_unbox = TRUE))
      quit(status = 1)
    }
    dat[[outcome_name]] <- as.numeric(as.factor(dat[[outcome_name]])) - 1
  }

  # Build formula
  pred_terms <- predictors
  if (!is.null(spline_vars) && length(spline_vars) > 0) {
    if (!requireNamespace("rms", quietly = TRUE)) {
      cat(toJSON(list(error = "rms package required for spline terms"), auto_unbox = TRUE))
      quit(status = 1)
    }
    library(rms)
    pred_terms <- vapply(pred_terms,
      function(p) if (p %in% spline_vars) paste0("rcs(", p, ", 3)") else p,
      character(1))
  }
  if (!is.null(interactions) && length(interactions) > 0) {
    for (int in interactions) {
      pred_terms <- c(pred_terms, paste0(int[[1]], ":", int[[2]]))
    }
  }
  formula_str <- paste0(outcome_name, " ~ ", paste(pred_terms, collapse = " + "))
  fml <- as.formula(formula_str)

  # Fit: survey-weighted if design columns are present and the caller said so;
  # plain glm() otherwise (future non-NHANES cohorts).
  use_survey <- has_survey && all(c(psu_col, str_col, wt_col) %in% names(dat))

  if (use_survey) {
    options(survey.lonely.psu = "adjust")
    dsn <- svydesign(
      ids = as.formula(paste0("~", psu_col)),
      strata = as.formula(paste0("~", str_col)),
      weights = as.formula(paste0("~", wt_col)),
      nest = TRUE,
      data = dat
    )
    fit <- if (model_type == "logistic") {
      svyglm(fml, design = dsn, family = quasibinomial())
    } else {
      svyglm(fml, design = dsn)
    }
  } else {
    fit <- if (model_type == "logistic") {
      glm(fml, data = dat, family = binomial())
    } else {
      lm(fml, data = dat)
    }
  }

  tidied <- tidy(fit, conf.int = TRUE)
  coefs <- lapply(seq_len(nrow(tidied)), function(i) list(
    term = tidied$term[i],
    estimate = round(as.numeric(tidied$estimate[i]), 6),
    std_error = round(as.numeric(tidied$std.error[i]), 6),
    statistic = round(as.numeric(tidied$statistic[i]), 4),
    p_value = as.numeric(tidied$p.value[i]),
    ci_lower = round(as.numeric(tidied$conf.low[i]), 6),
    ci_upper = round(as.numeric(tidied$conf.high[i]), 6)
  ))

  fit_stats <- list(aic = round(AIC(fit), 2))
  if (model_type == "linear") {
    if (use_survey) {
      yvals <- dat[[outcome_name]]
      ss_res <- sum(fit$residuals^2 * dat[[wt_col]])
      ss_tot <- sum((yvals - weighted.mean(yvals, dat[[wt_col]]))^2 * dat[[wt_col]])
      if (ss_tot > 0) fit_stats$r_squared <- round(1 - ss_res / ss_tot, 6)
    } else {
      fit_stats$r_squared <- round(summary(fit)$r.squared, 6)
    }
  }

  output <- list(
    outcome = outcome_name,
    predictors = predictors,
    model_type = model_type,
    formula = formula_str,
    n = nrow(dat),
    cycles_used = cycles,
    survey_weighted = use_survey,
    coefficients = coefs,
    fit_statistics = fit_stats,
    splines_used = spline_vars,
    interactions_used = interactions
  )
  cat(toJSON(output, auto_unbox = TRUE, null = "null"))

}, error = function(e) {
  cat(toJSON(list(error = conditionMessage(e)), auto_unbox = TRUE))
  quit(status = 1)
}, finally = {
  try(dbDisconnect(con), silent = TRUE)
})
