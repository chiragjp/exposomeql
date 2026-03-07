#!/usr/bin/env Rscript
# Survey-weighted regression analysis for ExposomeQL
# Wraps nhanespewas pe_flex_adjust() to run exposure-phenotype regression
# across all 9 adjustment scenarios

suppressPackageStartupMessages({
  library(jsonlite)
  library(survey)
  library(DBI)
  library(RSQLite)
  library(dplyr)
  library(broom)
  library(stringr)
  library(purrr)
  library(tidyr)
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
outcome <- params$outcome
cycles <- params$cycles

con <- connect_pewas_data(db_path)
on.exit(disconnect_pewas_data(con), add = TRUE)

if (is.null(cycles)) {
  tab_info <- get_table_names_for_varname(con, exposure)
  yr2s <- c("1999"="A","2001"="B","2003"="C","2005"="D","2007"="E","2009"="F","2011"="G","2013"="H","2015"="I","2017"="J")
  cycles <- tail(sort(unique(yr2s[as.character(tab_info$Begin.Year)])), 1)
}

tryCatch({
  all_results <- list()

  for (s in cycles) {
    # Get adjustment scenarios appropriate for this exposure-phenotype pair
    adj_models <- adjustment_scenario_for_variable(exposure, outcome)

    # Check exposure data type
    e_type <- check_e_data_type(exposure, con)

    # Run pe_flex_adjust with appropriate settings
    mod <- tryCatch({
      if (e_type$vartype == "continuous") {
        pe_flex_adjust(
          pheno = outcome,
          exposure = exposure,
          adjustment_variables = adj_models,
          con = con,
          series = s,
          logxform_p = FALSE,
          logxform_e = TRUE,
          scale_e = TRUE,
          scale_p = FALSE
        )
      } else if (e_type$vartype == "categorical") {
        pe_flex_adjust(
          pheno = outcome,
          exposure = exposure,
          adjustment_variables = adj_models,
          con = con,
          series = s,
          logxform_p = FALSE,
          logxform_e = FALSE,
          scale_e = FALSE,
          scale_p = FALSE,
          exposure_levels = e_type$varlevels
        )
      } else {
        # continuous-rank
        pe_flex_adjust(
          pheno = outcome,
          exposure = exposure,
          adjustment_variables = adj_models,
          con = con,
          series = s,
          logxform_p = FALSE,
          logxform_e = FALSE,
          scale_e = TRUE,
          scale_p = FALSE
        )
      }
    }, error = function(e) {
      list(error = conditionMessage(e))
    })

    if (!is.null(mod$error)) {
      all_results[[s]] <- list(series = s, error = mod$error)
      next
    }

    # Extract tidied results from each adjustment model
    # Get unique scenario names for labeling
    scenario_names <- unique(adj_models$scenario)

    scenario_results <- list()
    for (i in seq_along(mod$models)) {
      tryCatch({
        m <- mod$models[[i]]
        if (is.null(m) || is.null(m$tidied)) next

        tidied <- m$tidied
        r2_val <- as.numeric(m$r2[1])

        # Find the exposure coefficient (named "expo" internally)
        expo_row <- tidied[grepl("^expo", tidied$term), ]
        if (nrow(expo_row) == 0) next

        est <- as.numeric(expo_row$estimate[1])
        se <- as.numeric(expo_row$std.error[1])
        stat <- as.numeric(expo_row$statistic[1])
        pval <- as.numeric(expo_row$p.value[1])

        scenario_name <- if (i <= length(scenario_names)) scenario_names[i] else paste0("model_", i)

        scenario_results[[length(scenario_results) + 1]] <- list(
          model_number = i,
          scenario = scenario_name,
          estimate = round(est, 6),
          std_error = round(se, 6),
          statistic = round(stat, 4),
          p_value = pval,
          ci_lower = round(est - 1.96 * se, 6),
          ci_upper = round(est + 1.96 * se, 6),
          r_squared = if (!is.na(r2_val)) round(r2_val, 4) else NULL
        )
      }, error = function(e) {})
    }

    all_results[[s]] <- list(
      series = s,
      exposure_type = e_type$vartype,
      log_transformed = (e_type$vartype == "continuous"),
      scaled = (e_type$vartype != "categorical"),
      unweighted_n = mod$unweighted_n,
      scenarios = scenario_results
    )
  }

  output <- list(
    exposure = exposure,
    outcome = outcome,
    cycles_used = cycles,
    results = all_results,
    note = "Exposure is log10-transformed and z-scored for continuous variables. Coefficients represent change in outcome per 1-SD change in log10(exposure)."
  )

  cat(toJSON(output, auto_unbox = TRUE, null = "null"))

}, error = function(e) {
  cat(toJSON(list(error = conditionMessage(e)), auto_unbox = TRUE))
  quit(status = 1)
})
