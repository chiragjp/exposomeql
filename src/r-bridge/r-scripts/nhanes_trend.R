#!/usr/bin/env Rscript
# Survey-weighted trend across NHANES cycles for ExposomeQL
# Computes mean/geometric_mean/median per cycle and tests for linear trend

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
subgroup <- params$subgroup
metric <- if (!is.null(params$metric)) params$metric else "mean"

con <- connect_pewas_data(db_path)
# on.exit removed for pool compatibility; cleanup handled in tryCatch finally

# Find all cycles that have this variable
tab_info <- get_table_names_for_varname(con, variable)
if (nrow(tab_info) == 0) {
  cat(toJSON(list(error = paste0("Variable ", variable, " not found")), auto_unbox = TRUE))
  quit(status = 0)
}

year_to_series <- c(
  "1999" = "A", "2001" = "B", "2003" = "C", "2005" = "D",
  "2007" = "E", "2009" = "F", "2011" = "G", "2013" = "H",
  "2015" = "I", "2017" = "J"
)

series_labels <- c(
  A = "1999-2000", B = "2001-2002", C = "2003-2004", D = "2005-2006",
  E = "2007-2008", F = "2009-2010", G = "2011-2012", H = "2013-2014",
  I = "2015-2016", J = "2017-2018"
)

# Map Begin.Year to series letters
all_cycles <- unique(year_to_series[as.character(tab_info$Begin.Year)])
all_cycles <- sort(all_cycles[!is.na(all_cycles)])

if (length(all_cycles) == 0) {
  cat(toJSON(list(error = "Could not map variable to any NHANES cycles"), auto_unbox = TRUE))
  quit(status = 0)
}

tryCatch({
  trend_data <- list()

  for (s in all_cycles) {
    tab_obj <- tryCatch(get_tables(variable, variable, s, con), error = function(e) NULL)
    if (is.null(tab_obj)) next
    tab_obj <- figure_out_weight(tab_obj)
    dat <- tab_obj$merged_tab
    if (is.null(dat) || nrow(dat) == 0) next

    dat <- dat %>% filter(!is.na(wt), wt > 0, !is.na(.data[[variable]]))
    if (!is.null(subgroup) && nzchar(subgroup)) {
      dat <- dat %>% filter(eval(parse(text = subgroup)))
    }
    if (nrow(dat) == 0) next

    options(survey.lonely.psu = "adjust")
    dsn <- svydesign(ids = ~SDMVPSU, strata = ~SDMVSTRA, weights = ~wt, nest = TRUE, data = dat)

    form <- as.formula(paste0("~", variable))

    val <- NA
    se_val <- NA
    ci_lo <- NA
    ci_hi <- NA

    if (metric == "mean") {
      res <- svymean(form, dsn, na.rm = TRUE)
      val <- as.numeric(coef(res))
      se_val <- as.numeric(SE(res))
      ci <- confint(res)
      ci_lo <- ci[1, 1]
      ci_hi <- ci[1, 2]
    } else if (metric == "geometric_mean") {
      dat_pos <- dat %>% filter(.data[[variable]] > 0)
      if (nrow(dat_pos) > 0) {
        dsn_pos <- svydesign(ids = ~SDMVPSU, strata = ~SDMVSTRA, weights = ~wt, nest = TRUE, data = dat_pos)
        log_res <- tryCatch(svymean(as.formula(paste0("~log(", variable, ")")), dsn_pos, na.rm = TRUE), error = function(e) NULL)
        if (!is.null(log_res)) {
          val <- exp(as.numeric(coef(log_res)))
          se_val <- val * as.numeric(SE(log_res))  # delta method approximation
        }
      }
    } else if (metric == "median") {
      q_res <- tryCatch(svyquantile(form, dsn, quantiles = 0.5, na.rm = TRUE), error = function(e) NULL)
      if (!is.null(q_res)) {
        val <- as.numeric(q_res[[1]])
      }
    }

    cycle_label <- if (s %in% names(series_labels)) series_labels[s] else s

    trend_data[[length(trend_data) + 1]] <- list(
      series = s,
      cycle = unname(cycle_label),
      value = round(val, 6),
      se = if (!is.na(se_val)) round(se_val, 6) else NULL,
      ci_lower = if (!is.na(ci_lo)) round(ci_lo, 6) else NULL,
      ci_upper = if (!is.na(ci_hi)) round(ci_hi, 6) else NULL,
      n_unweighted = nrow(dat)
    )
  }

  if (length(trend_data) == 0) {
    cat(toJSON(list(error = "No data found for any cycle"), auto_unbox = TRUE))
    quit(status = 0)
  }

  # Simple trend test: linear regression of metric value on cycle midpoint year
  values <- sapply(trend_data, function(x) x$value)
  midpoints <- sapply(trend_data, function(x) {
    yr <- as.numeric(substring(x$cycle, 1, 4))
    if (!is.na(yr)) yr + 0.5 else NA
  })

  trend_test <- NULL
  if (sum(!is.na(values) & !is.na(midpoints)) >= 3) {
    fit <- lm(values ~ midpoints)
    s <- summary(fit)
    trend_test <- list(
      slope = round(coef(fit)[2], 6),
      p_value = round(s$coefficients[2, 4], 6),
      direction = if (coef(fit)[2] > 0) "increasing" else "decreasing",
      note = "Simple OLS trend across cycle midpoints (not survey-weighted)"
    )
  }

  output <- list(
    variable = variable,
    metric = metric,
    n_cycles = length(trend_data),
    trend = trend_data,
    trend_test = trend_test
  )

  cat(toJSON(output, auto_unbox = TRUE, null = "null"))

}, error = function(e) {
  cat(toJSON(list(error = conditionMessage(e)), auto_unbox = TRUE))
  quit(status = 1)
}, finally = {
  try(disconnect_pewas_data(con), silent = TRUE)
})
