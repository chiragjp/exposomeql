#!/usr/bin/env Rscript
# Survey-weighted stratified summary statistics for ExposomeQL
# Computes means + CIs by stratification variables using svyby()

suppressPackageStartupMessages({
  library(jsonlite)
  library(survey)
  library(DBI)
  library(RSQLite)
  library(dplyr)
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

variable <- params$variable
by_vars <- params$by           # character vector of stratification variables
cycles <- params$cycles
subgroup <- params$subgroup

con <- connect_pewas_data(db_path)
# on.exit removed for pool compatibility; cleanup handled in tryCatch finally

if (is.null(cycles)) {
  tab_info <- get_table_names_for_varname(con, variable)
  yr2s <- c("1999"="A","2001"="B","2003"="C","2005"="D","2007"="E","2009"="F","2011"="G","2013"="H","2015"="I","2017"="J")
  cycles <- tail(sort(unique(yr2s[as.character(tab_info$Begin.Year)])), 1)
}

tryCatch({
  # Need to get the outcome and all by-variables from the database
  # Use the first by_var as the "second" variable in get_tables
  all_data <- NULL
  for (s in cycles) {
    tab_obj <- tryCatch(get_tables(variable, variable, s, con), error = function(e) NULL)
    if (is.null(tab_obj)) next
    tab_obj <- tryCatch(figure_out_weight(tab_obj), error = function(e) {
      tab_obj$merged_tab$wt <- tab_obj$merged_tab$WTMEC2YR
      if (is.null(tab_obj$merged_tab$wt) || all(is.na(tab_obj$merged_tab$wt))) {
        tab_obj$merged_tab$wt <- tab_obj$merged_tab$WTINT2YR
      }
      tab_obj
    })
    dat <- tab_obj$merged_tab
    if (!is.null(dat) && nrow(dat) > 0) {
      if (is.null(all_data)) all_data <- dat
      else {
        common_cols <- intersect(names(all_data), names(dat))
        all_data <- rbind(all_data[, common_cols], dat[, common_cols])
      }
    }
  }

  if (is.null(all_data) || nrow(all_data) == 0) {
    cat(toJSON(list(error = "No data found"), auto_unbox = TRUE))
    quit(status = 0)
  }

  # Check that all by_vars are present
  missing_vars <- by_vars[!by_vars %in% names(all_data)]
  if (length(missing_vars) > 0) {
    cat(toJSON(list(error = paste0("Stratification variable(s) not found in data: ", paste(missing_vars, collapse = ", "))), auto_unbox = TRUE))
    quit(status = 0)
  }

  dat <- all_data %>% filter(!is.na(wt), wt > 0, !is.na(.data[[variable]]))
  for (bv in by_vars) {
    dat <- dat %>% filter(!is.na(.data[[bv]]))
  }

  if (!is.null(subgroup) && nzchar(subgroup)) {
    dat <- dat %>% filter(eval(parse(text = subgroup)))
  }

  n_cycles <- length(cycles)
  if (n_cycles > 1) dat$wt <- dat$wt / n_cycles

  # Convert by_vars to factors and drop single-level vars
  for (bv in by_vars) {
    dat[[bv]] <- as.factor(dat[[bv]])
  }
  single_level <- sapply(by_vars, function(bv) nlevels(dat[[bv]]) < 2)
  if (any(single_level)) {
    dropped <- by_vars[single_level]
    by_vars <- by_vars[!single_level]
    if (length(by_vars) == 0) {
      cat(toJSON(list(error = paste0("All stratification variables have only 1 level after filtering: ", paste(dropped, collapse = ", "))), auto_unbox = TRUE))
      quit(status = 0)
    }
  }

  options(survey.lonely.psu = "adjust")
  dsn <- svydesign(ids = ~SDMVPSU, strata = ~SDMVSTRA, weights = ~wt, nest = TRUE, data = dat)

  # Compute stratified means
  outcome_form <- as.formula(paste0("~", variable))
  by_form <- as.formula(paste0("~", paste(by_vars, collapse = "+")))

  result <- svyby(outcome_form, by_form, dsn, svymean, na.rm = TRUE, vartype = c("se", "ci"))

  # Convert to data frame
  result_df <- as.data.frame(result)

  # Design-adjusted ANOVA (test for differences across groups)
  anova_test <- NULL
  tryCatch({
    # Fit model with group variable(s)
    model_form <- as.formula(paste0(variable, " ~ ", paste(by_vars, collapse = " + ")))
    fit <- svyglm(model_form, design = dsn)
    anova_result <- regTermTest(fit, paste(by_vars, collapse = " + "))
    anova_test <- list(
      f_statistic = round(as.numeric(anova_result$Ftest), 4),
      df_num = anova_result$df,
      df_denom = anova_result$ddf,
      p_value = anova_result$p,
      method = "Design-adjusted Wald test (regTermTest)"
    )
  }, error = function(e) {})

  # Compute group N
  n_by_group <- dat %>%
    group_by(across(all_of(by_vars))) %>%
    summarise(n = n(), .groups = "drop")

  output <- list(
    variable = variable,
    by = by_vars,
    strata = result_df,
    anova_test = anova_test,
    n_by_group = as.data.frame(n_by_group),
    n_total = nrow(dat),
    cycles_used = cycles
  )

  cat(toJSON(output, auto_unbox = TRUE, null = "null"))

}, error = function(e) {
  cat(toJSON(list(error = conditionMessage(e)), auto_unbox = TRUE))
  quit(status = 1)
}, finally = {
  try(disconnect_pewas_data(con), silent = TRUE)
})
