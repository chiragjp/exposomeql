#!/usr/bin/env Rscript
# Prediction from a survey-weighted regression model for ExposomeQL
# Re-fits the model (stateless) and predicts at user-specified covariate values

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

has_rms <- requireNamespace("rms", quietly = TRUE)

params <- if (exists("POOL_PARAMS", envir = globalenv())) get("POOL_PARAMS", envir = globalenv()) else fromJSON(file("stdin"))
db_path <- Sys.getenv("EXPOSOMEQL_DB_PATH")

outcome_var <- params$outcome
predictors <- params$predictors
model_type <- params$model_type
spline_vars <- params$splines
newdata <- params$newdata  # named list of values
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

  # Load data
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
    cat(toJSON(list(error = "No data found"), auto_unbox = TRUE))
    quit(status = 1)
  }

  # Load additional variable tables if needed
  missing_vars <- setdiff(all_vars, names(all_data))
  if (length(missing_vars) > 0 && "SEQN" %in% names(all_data)) {
    for (mv in missing_vars) {
      tab_info <- tryCatch(get_table_names_for_varname(con, mv), error = function(e) NULL)
      if (!is.null(tab_info) && nrow(tab_info) > 0) {
        for (s in cycles) {
          yr2s <- c("A"=1999,"B"=2001,"C"=2003,"D"=2005,"E"=2007,"F"=2009,"G"=2011,"H"=2013,"I"=2015,"J"=2017)
          yr <- yr2s[s]
          tab_row <- tab_info[!is.na(tab_info$Begin.Year) & tab_info$Begin.Year == yr, ]
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

  # Filter
  dat <- all_data %>% filter(!is.na(wt), wt > 0)
  for (v in all_vars) {
    dat <- dat %>% filter(!is.na(.data[[v]]))
  }

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

  # Detect categorical predictors
  for (p in predictors) {
    vals <- dat[[p]]
    if (is.character(vals) || is.factor(vals) || length(unique(vals[!is.na(vals)])) <= 10) {
      dat[[p]] <- as.factor(dat[[p]])
    }
  }

  if (model_type == "logistic") {
    out_vals <- unique(dat[[outcome_var]])
    if (length(out_vals) > 2) {
      cat(toJSON(list(error = "Logistic regression requires binary outcome."), auto_unbox = TRUE))
      quit(status = 1)
    }
    dat[[outcome_var]] <- as.numeric(as.factor(dat[[outcome_var]])) - 1
  }

  # Build formula (same as nhanes_model.R)
  pred_terms <- c()
  for (p in predictors) {
    if (!is.null(spline_vars) && p %in% spline_vars) {
      if (!has_rms) {
        cat(toJSON(list(error = "R package 'rms' required for splines."), auto_unbox = TRUE))
        quit(status = 1)
      }
      library(rms)
      pred_terms <- c(pred_terms, paste0("rcs(", p, ", 3)"))
    } else {
      pred_terms <- c(pred_terms, p)
    }
  }

  formula_str <- paste0(outcome_var, " ~ ", paste(pred_terms, collapse = " + "))
  fml <- as.formula(formula_str)

  # Survey design
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
  }

  # Build prediction data frame
  pred_df <- as.data.frame(newdata, stringsAsFactors = FALSE)
  # Ensure factor levels match training data
  for (p in predictors) {
    if (is.factor(dat[[p]]) && p %in% names(pred_df)) {
      pred_df[[p]] <- factor(pred_df[[p]], levels = levels(dat[[p]]))
    }
    if (is.numeric(dat[[p]]) && p %in% names(pred_df)) {
      pred_df[[p]] <- as.numeric(pred_df[[p]])
    }
  }

  # Predict
  pred <- predict(fit, newdata = pred_df, se.fit = TRUE)
  pred_val <- as.numeric(pred)
  pred_se <- sqrt(as.numeric(attr(pred, "var")))

  if (model_type == "logistic") {
    # Convert to probability scale
    prob <- 1 / (1 + exp(-pred_val))
    prob_lower <- 1 / (1 + exp(-(pred_val - 1.96 * pred_se)))
    prob_upper <- 1 / (1 + exp(-(pred_val + 1.96 * pred_se)))

    output <- list(
      outcome = outcome_var,
      model_type = model_type,
      formula = formula_str,
      newdata = newdata,
      prediction = list(
        log_odds = round(pred_val, 6),
        probability = round(prob, 6),
        se_log_odds = round(pred_se, 6),
        ci_lower_prob = round(prob_lower, 6),
        ci_upper_prob = round(prob_upper, 6)
      ),
      n_training = nrow(dat),
      cycles_used = cycles
    )
  } else {
    output <- list(
      outcome = outcome_var,
      model_type = model_type,
      formula = formula_str,
      newdata = newdata,
      prediction = list(
        predicted_value = round(pred_val, 6),
        se = round(pred_se, 6),
        ci_lower = round(pred_val - 1.96 * pred_se, 6),
        ci_upper = round(pred_val + 1.96 * pred_se, 6)
      ),
      n_training = nrow(dat),
      cycles_used = cycles
    )
  }

  cat(toJSON(output, auto_unbox = TRUE, null = "null"))

}, error = function(e) {
  cat(toJSON(list(error = conditionMessage(e)), auto_unbox = TRUE))
  quit(status = 1)
}, finally = {
  try(disconnect_pewas_data(con), silent = TRUE)
})
