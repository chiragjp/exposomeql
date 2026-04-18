#!/usr/bin/env Rscript
# Exposome-Wide Association Study (ExWAS) for ExposomeQL
# Iterates over multiple exposures against a single outcome
# Exposure list is passed from the TypeScript layer (queried via DuckDB)
# WARNING: Can take 5-30 minutes depending on number of exposures

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
if (!isNamespaceLoaded("nhanespewas")) {
  if (nzchar(nhanespewas_path) && file.exists(file.path(nhanespewas_path, "DESCRIPTION")) && requireNamespace("devtools", quietly = TRUE)) {
    suppressPackageStartupMessages(devtools::load_all(nhanespewas_path, quiet = TRUE))
  } else {
    suppressPackageStartupMessages(library(nhanespewas))
  }
}

params <- if (exists("POOL_PARAMS", envir = globalenv())) get("POOL_PARAMS", envir = globalenv()) else fromJSON(file("stdin"))
db_path <- Sys.getenv("EXPOSOMEQL_DB_PATH")

outcome <- params$outcome
exposures <- params$exposures   # character vector of exposure variable names (from TypeScript)
cycles <- params$cycles

con <- connect_pewas_data(db_path)
# on.exit removed for pool compatibility; cleanup handled in tryCatch finally

if (is.null(cycles)) {
  tab_info <- get_table_names_for_varname(con, outcome)
  yr2s <- c("1999"="A","2001"="B","2003"="C","2005"="D","2007"="E","2009"="F","2011"="G","2013"="H","2015"="I","2017"="J")
  cycles <- tail(sort(unique(yr2s[as.character(tab_info$Begin.Year)])), 1)
}

if (is.null(exposures) || length(exposures) == 0) {
  cat(toJSON(list(error = "No exposures provided. Pass an exposure list from the TypeScript layer."), auto_unbox = TRUE))
  quit(status = 1)
}

message(paste0("[exposomeql] Running ExWAS: ", length(exposures), " exposures x ", outcome, " (cycle ", paste(cycles, collapse=","), ")"))

tryCatch({
  results <- list()
  errors <- character()

  for (expo in exposures) {
    tryCatch({
      for (s in cycles) {
        adj_models <- adjustment_scenario_for_variable(expo, outcome)
        # Use model 6 (age+sex+ethnicity) as default
        adj_models <- adj_models %>% filter(scenario == "age_sex_ethnicity")

        e_type <- check_e_data_type(expo, con)

        mod <- if (e_type$vartype == "continuous") {
          pe_flex_adjust(
            pheno = outcome, exposure = expo,
            adjustment_variables = adj_models, con = con, series = s,
            logxform_p = FALSE, logxform_e = TRUE, scale_e = TRUE, scale_p = FALSE
          )
        } else if (e_type$vartype == "categorical") {
          pe_flex_adjust(
            pheno = outcome, exposure = expo,
            adjustment_variables = adj_models, con = con, series = s,
            logxform_p = FALSE, logxform_e = FALSE, scale_e = FALSE, scale_p = FALSE,
            exposure_levels = e_type$varlevels
          )
        } else {
          pe_flex_adjust(
            pheno = outcome, exposure = expo,
            adjustment_variables = adj_models, con = con, series = s,
            logxform_p = FALSE, logxform_e = FALSE, scale_e = TRUE, scale_p = FALSE
          )
        }

        # Extract the exposure coefficient
        if (!is.null(mod$models) && length(mod$models) > 0) {
          m <- mod$models[[1]]
          if (!is.null(m$tidied)) {
            expo_row <- m$tidied[grepl("^expo", m$tidied$term), ]
            if (nrow(expo_row) > 0) {
              est <- as.numeric(expo_row$estimate[1])
              se <- as.numeric(expo_row$std.error[1])
              pval <- as.numeric(expo_row$p.value[1])
              results[[length(results) + 1]] <- list(
                exposure = expo,
                series = s,
                estimate = round(est, 6),
                std_error = round(se, 6),
                p_value = pval,
                n = mod$unweighted_n,
                exposure_type = e_type$vartype
              )
            }
          }
        }
      }
    }, error = function(e) {
      errors <<- c(errors, paste0(expo, ": ", conditionMessage(e)))
    })
  }

  # Sort by p-value
  if (length(results) > 0) {
    pvals <- sapply(results, function(x) x$p_value)
    results <- results[order(pvals)]

    # Apply Bonferroni and BH-FDR corrections
    n_tests <- length(results)
    sorted_pvals <- sapply(results, function(x) x$p_value)
    bonferroni <- pmin(sorted_pvals * n_tests, 1)
    bh_fdr <- p.adjust(sorted_pvals, method = "BH")

    for (i in seq_along(results)) {
      results[[i]]$p_bonferroni <- bonferroni[i]
      results[[i]]$p_fdr_bh <- bh_fdr[i]
    }
  }

  output <- list(
    outcome = outcome,
    n_exposures_tested = length(exposures),
    n_results = length(results),
    n_errors = length(errors),
    cycles_used = cycles,
    results = results,
    errors = if (length(errors) > 0) errors else NULL,
    note = "P-values corrected for multiple testing: p_bonferroni and p_fdr_bh (Benjamini-Hochberg). Model: age+sex+ethnicity adjusted."
  )

  cat(toJSON(output, auto_unbox = TRUE, null = "null"))

}, error = function(e) {
  cat(toJSON(list(error = conditionMessage(e)), auto_unbox = TRUE))
  quit(status = 1)
}, finally = {
  try(disconnect_pewas_data(con), silent = TRUE)
})
