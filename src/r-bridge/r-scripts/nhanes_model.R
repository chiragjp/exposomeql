#!/usr/bin/env Rscript
# Flexible survey-weighted regression model for ExposomeQL
# Supports: linear, logistic, quantile regression
# Optional: restricted cubic splines (rms::rcs), interactions

suppressPackageStartupMessages({
  library(jsonlite)
  library(survey)
  library(DBI)
  library(RSQLite)
  library(dplyr)
  library(broom)
})

nhanespewas_path <- Sys.getenv("NHANESPEWAS_PATH")
if (!isNamespaceLoaded("nhanespewas")) {
  if (nzchar(nhanespewas_path) && file.exists(file.path(nhanespewas_path, "DESCRIPTION")) && requireNamespace("devtools", quietly = TRUE)) {
    suppressPackageStartupMessages(devtools::load_all(nhanespewas_path, quiet = TRUE))
  } else {
    suppressPackageStartupMessages(library(nhanespewas))
  }
}

# Load rms if splines requested (loaded conditionally)
has_rms <- requireNamespace("rms", quietly = TRUE)

params <- if (exists("POOL_PARAMS", envir = globalenv())) get("POOL_PARAMS", envir = globalenv()) else fromJSON(file("stdin"))
db_path <- Sys.getenv("EXPOSOMEQL_DB_PATH")

outcome_var <- params$outcome
predictors <- params$predictors    # character vector
model_type <- params$model_type    # "linear", "logistic", "quantile"
spline_vars <- params$splines      # character vector or NULL
interactions <- params$interactions # list of 2-element vectors or NULL
cycles <- params$cycles

if (is.null(model_type)) model_type <- "linear"

con <- connect_pewas_data(db_path)
# on.exit removed for pool compatibility; cleanup handled in tryCatch finally

if (is.null(cycles)) {
  tab_info <- get_table_names_for_varname(con, outcome_var)
  yr2s <- c("1999"="A","2001"="B","2003"="C","2005"="D","2007"="E","2009"="F","2011"="G","2013"="H","2015"="I","2017"="J")
  cycles <- tail(sort(unique(yr2s[as.character(tab_info$Begin.Year)])), 1)
}

tryCatch({
  all_vars <- unique(c(outcome_var, predictors))

  # Load data — use outcome for both args to ensure DEMO+outcome table are loaded
  # Additional predictor tables loaded via the extra-table mechanism below
  all_data <- NULL
  for (s in cycles) {
    tab_obj <- tryCatch(
      get_tables(outcome_var, outcome_var, s, con),
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

  # Load additional variable tables if needed
  missing_vars <- setdiff(all_vars, names(all_data))
  if (length(missing_vars) > 0 && "SEQN" %in% names(all_data)) {
    for (mv in missing_vars) {
      tab_info <- tryCatch(get_table_names_for_varname(con, mv), error = function(e) NULL)
      if (!is.null(tab_info) && nrow(tab_info) > 0) {
        # Exclude pandemic pre-release tables (P_DEMO, P_BMX, etc.) — they use a
        # different weight scheme (WTMECPRP) and cannot be pooled with A–J cycles.
        tab_info <- tab_info[!grepl("^P_", tab_info$Data.File.Name), ]
        if (nrow(tab_info) == 0) next
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

  # Adjust weights for multi-cycle pooling
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

  # Detect categorical predictors (<=10 unique levels or character/factor)
  for (p in predictors) {
    vals <- dat[[p]]
    if (is.character(vals) || is.factor(vals) || length(unique(vals[!is.na(vals)])) <= 10) {
      dat[[p]] <- as.factor(dat[[p]])
    }
  }

  # For logistic regression, ensure binary outcome
  if (model_type == "logistic") {
    out_vals <- unique(dat[[outcome_var]])
    if (length(out_vals) > 2) {
      cat(toJSON(list(error = paste0("Logistic regression requires binary outcome. Found ", length(out_vals), " unique values.")), auto_unbox = TRUE))
      quit(status = 1)
    }
    dat[[outcome_var]] <- as.numeric(as.factor(dat[[outcome_var]])) - 1
  }

  # Build formula
  pred_terms <- c()
  for (p in predictors) {
    if (!is.null(spline_vars) && p %in% spline_vars) {
      if (!has_rms) {
        cat(toJSON(list(error = "R package 'rms' is required for spline terms but not installed."), auto_unbox = TRUE))
        quit(status = 1)
      }
      library(rms)
      pred_terms <- c(pred_terms, paste0("rcs(", p, ", 3)"))
    } else {
      pred_terms <- c(pred_terms, p)
    }
  }

  # Add interactions
  if (!is.null(interactions) && length(interactions) > 0) {
    for (int in interactions) {
      pred_terms <- c(pred_terms, paste0(int[1], ":", int[2]))
    }
  }

  formula_str <- paste0(outcome_var, " ~ ", paste(pred_terms, collapse = " + "))
  fml <- as.formula(formula_str)

  # Create survey design
  options(survey.lonely.psu = "adjust")
  dsn <- svydesign(
    ids = ~SDMVPSU,
    strata = ~SDMVSTRA,
    weights = ~wt,
    nest = TRUE,
    data = dat
  )

  # Fit model
  if (model_type == "linear") {
    fit <- svyglm(fml, design = dsn)
  } else if (model_type == "logistic") {
    fit <- svyglm(fml, design = dsn, family = quasibinomial())
  } else if (model_type == "quantile") {
    # quantile regression — use quantreg on weighted data
    suppressPackageStartupMessages(library(quantreg))
    fit <- rq(fml, data = dat, tau = 0.5, weights = dat$wt)
  }

  # Extract coefficients
  if (model_type == "quantile") {
    smry <- summary(fit, se = "nid")
    coefs_df <- as.data.frame(smry$coefficients)
    coefs_df$term <- rownames(coefs_df)
    names(coefs_df) <- c("estimate", "std_error", "t_value", "p_value", "term")

    coefs <- lapply(seq_len(nrow(coefs_df)), function(i) {
      list(
        term = coefs_df$term[i],
        estimate = round(coefs_df$estimate[i], 6),
        std_error = round(coefs_df$std_error[i], 6),
        statistic = round(coefs_df$t_value[i], 4),
        p_value = coefs_df$p_value[i]
      )
    })
  } else {
    tidied <- tidy(fit, conf.int = TRUE)
    coefs <- lapply(seq_len(nrow(tidied)), function(i) {
      list(
        term = tidied$term[i],
        estimate = round(as.numeric(tidied$estimate[i]), 6),
        std_error = round(as.numeric(tidied$std.error[i]), 6),
        statistic = round(as.numeric(tidied$statistic[i]), 4),
        p_value = as.numeric(tidied$p.value[i]),
        ci_lower = round(as.numeric(tidied$conf.low[i]), 6),
        ci_upper = round(as.numeric(tidied$conf.high[i]), 6)
      )
    })
  }

  # Model fit statistics
  fit_stats <- list()
  if (model_type == "linear") {
    ss_res <- sum(fit$residuals^2 * dat$wt)
    ss_tot <- sum((dat[[outcome_var]] - weighted.mean(dat[[outcome_var]], dat$wt))^2 * dat$wt)
    if (ss_tot > 0) fit_stats$r_squared <- round(1 - ss_res / ss_tot, 6)
    fit_stats$aic <- round(AIC(fit), 2)
  } else if (model_type == "logistic") {
    fit_stats$aic <- round(AIC(fit), 2)
  } else if (model_type == "quantile") {
    # Pseudo R² for quantile regression
    null_fit <- rq(as.formula(paste0(outcome_var, " ~ 1")), data = dat, tau = 0.5, weights = dat$wt)
    rho <- function(u, tau) u * (tau - (u < 0))
    r2 <- 1 - sum(rho(fit$residuals, 0.5)) / sum(rho(null_fit$residuals, 0.5))
    fit_stats$pseudo_r_squared <- round(r2, 6)
  }

  output <- list(
    outcome = outcome_var,
    predictors = predictors,
    model_type = model_type,
    formula = formula_str,
    n = nrow(dat),
    cycles_used = cycles,
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
  try(disconnect_pewas_data(con), silent = TRUE)
})
