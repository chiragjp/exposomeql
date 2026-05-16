#!/usr/bin/env Rscript
# Survey-weighted interaction (effect modification) analysis for ExposomeQL
# Tests whether the exposure→outcome association differs by levels of a modifier
# Returns main effects, interaction term, and stratified effects

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

params <- if (exists("POOL_PARAMS", envir = globalenv())) get("POOL_PARAMS", envir = globalenv()) else fromJSON(file("stdin"))
db_path <- Sys.getenv("EXPOSOMEQL_DB_PATH")

exposure <- params$exposure
modifier <- params$modifier
outcome <- params$outcome
covariates <- params$covariates  # character vector or NULL
cycles <- params$cycles

con <- connect_pewas_data(db_path)
# on.exit removed for pool compatibility; cleanup handled in tryCatch finally

if (is.null(cycles)) {
  tab_info <- get_table_names_for_varname(con, exposure)
  yr2s <- c("1999"="A","2001"="B","2003"="C","2005"="D","2007"="E","2009"="F","2011"="G","2013"="H","2015"="I","2017"="J")
  cycles <- tail(sort(unique(yr2s[as.character(tab_info$Begin.Year)])), 1)
}

tryCatch({
  all_vars <- unique(c(exposure, modifier, outcome, covariates))

  # Load data across cycles
  all_data <- NULL
  for (s in cycles) {
    tab_obj <- tryCatch(
      get_tables(exposure, outcome, s, con),
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

  # Load additional variable tables if needed (e.g., modifier not in exposure/outcome tables)
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
            tab_name <- tab_row$Data.File.Name[1]  # Already the full table name
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
    cat(toJSON(list(error = paste0("Variables not found in data: ", paste(missing_vars, collapse = ", "))), auto_unbox = TRUE))
    quit(status = 1)
  }

  # Filter to valid data
  dat <- all_data %>%
    filter(!is.na(wt), wt > 0,
           !is.na(.data[[exposure]]),
           !is.na(.data[[modifier]]),
           !is.na(.data[[outcome]]))

  # Filter covariates for complete cases
  if (!is.null(covariates) && length(covariates) > 0) {
    for (cov in covariates) {
      dat <- dat %>% filter(!is.na(.data[[cov]]))
    }
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
    cat(toJSON(list(error = paste0("Insufficient sample size (n=", nrow(dat), "). Need at least 30.")), auto_unbox = TRUE))
    quit(status = 1)
  }

  # Determine if modifier is categorical or continuous
  modifier_vals <- dat[[modifier]]
  modifier_is_categorical <- is.character(modifier_vals) ||
    is.factor(modifier_vals) ||
    length(unique(modifier_vals[!is.na(modifier_vals)])) <= 10

  if (modifier_is_categorical) {
    dat[[modifier]] <- as.factor(dat[[modifier]])
    if (nlevels(dat[[modifier]]) < 2) {
      cat(toJSON(list(error = paste0("Modifier '", modifier, "' has only ", nlevels(dat[[modifier]]), " level(s). Interaction analysis requires at least 2 levels.")), auto_unbox = TRUE))
      quit(status = 1)
    }
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

  # Build formula with interaction
  cov_terms <- ""
  if (!is.null(covariates) && length(covariates) > 0) {
    cov_terms <- paste0(" + ", paste(covariates, collapse = " + "))
  }

  # Full model with interaction
  full_fml <- as.formula(paste0(outcome, " ~ ", exposure, " * ", modifier, cov_terms))
  # Reduced model without interaction
  reduced_fml <- as.formula(paste0(outcome, " ~ ", exposure, " + ", modifier, cov_terms))

  fit_full <- svyglm(full_fml, design = dsn)
  fit_reduced <- svyglm(reduced_fml, design = dsn)

  # Interaction test — use coefficient-level p-value from interaction term(s)
  interaction_test <- tryCatch({
    tidied <- tidy(fit_full)
    int_rows <- tidied[grepl(":", tidied$term), ]
    if (nrow(int_rows) > 0) {
      # If multiple interaction terms (categorical modifier), use smallest p
      min_idx <- which.min(int_rows$p.value)
      list(
        test = "Wald (interaction term coefficient)",
        statistic = round(as.numeric(int_rows$statistic[min_idx]), 4),
        df = nrow(int_rows),
        p_value = as.numeric(int_rows$p.value[min_idx]),
        interaction_terms = int_rows$term
      )
    } else {
      list(test = "Wald", statistic = NA, df = NA, p_value = NA)
    }
  }, error = function(e) {
    list(test = "Wald", error = conditionMessage(e))
  })

  # Full model coefficients
  tidied_full <- tidy(fit_full, conf.int = TRUE)
  full_coefs <- lapply(seq_len(nrow(tidied_full)), function(i) {
    list(
      term = tidied_full$term[i],
      estimate = round(as.numeric(tidied_full$estimate[i]), 6),
      std_error = round(as.numeric(tidied_full$std.error[i]), 6),
      statistic = round(as.numeric(tidied_full$statistic[i]), 4),
      p_value = as.numeric(tidied_full$p.value[i]),
      ci_lower = round(as.numeric(tidied_full$conf.low[i]), 6),
      ci_upper = round(as.numeric(tidied_full$conf.high[i]), 6)
    )
  })

  # Stratified effects: exposure effect at each level of modifier
  stratified <- list()
  if (modifier_is_categorical) {
    levels_mod <- levels(dat[[modifier]])
    for (lev in levels_mod) {
      sub_dsn <- subset(dsn, dat[[modifier]] == lev)
      sub_fml <- as.formula(paste0(outcome, " ~ ", exposure, cov_terms))
      sub_fit <- tryCatch({
        svyglm(sub_fml, design = sub_dsn)
      }, error = function(e) NULL)
      if (!is.null(sub_fit)) {
        sub_tidied <- tidy(sub_fit, conf.int = TRUE)
        expo_row <- sub_tidied[sub_tidied$term == exposure, ]
        if (nrow(expo_row) > 0) {
          stratified[[length(stratified) + 1]] <- list(
            modifier_level = lev,
            n = nrow(sub_dsn$variables),
            estimate = round(as.numeric(expo_row$estimate[1]), 6),
            std_error = round(as.numeric(expo_row$std.error[1]), 6),
            p_value = as.numeric(expo_row$p.value[1]),
            ci_lower = round(as.numeric(expo_row$conf.low[1]), 6),
            ci_upper = round(as.numeric(expo_row$conf.high[1]), 6)
          )
        }
      }
    }
  } else {
    # For continuous modifier, report effect at percentiles
    mod_quantiles <- quantile(dat[[modifier]], probs = c(0.25, 0.50, 0.75), na.rm = TRUE)
    for (q in names(mod_quantiles)) {
      val <- mod_quantiles[q]
      # Effect of exposure at this modifier value: beta_exposure + beta_interaction * modifier_value
      tidied <- tidy(fit_full)
      main_row <- tidied[tidied$term == exposure, ]
      int_row <- tidied[grepl(paste0(exposure, ":"), tidied$term), ]
      if (nrow(main_row) > 0 && nrow(int_row) > 0) {
        effect <- as.numeric(main_row$estimate[1]) + as.numeric(int_row$estimate[1]) * val
        stratified[[length(stratified) + 1]] <- list(
          modifier_percentile = q,
          modifier_value = round(val, 4),
          estimated_effect = round(effect, 6)
        )
      }
    }
  }

  output <- list(
    exposure = exposure,
    modifier = modifier,
    outcome = outcome,
    modifier_type = if (modifier_is_categorical) "categorical" else "continuous",
    n = nrow(dat),
    cycles_used = cycles,
    interaction_test = interaction_test,
    full_model_coefficients = full_coefs,
    stratified_effects = stratified,
    formula = deparse(full_fml),
    note = "Interaction test assesses whether the exposure-outcome association differs across levels of the modifier."
  )

  cat(toJSON(output, auto_unbox = TRUE, null = "null"))

}, error = function(e) {
  cat(toJSON(list(error = conditionMessage(e)), auto_unbox = TRUE))
  quit(status = 1)
}, finally = {
  try(disconnect_pewas_data(con), silent = TRUE)
})
