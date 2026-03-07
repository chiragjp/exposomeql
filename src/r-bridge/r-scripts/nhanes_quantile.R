#!/usr/bin/env Rscript
# Survey-weighted quantile for ExposomeQL

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

variable <- params$variable
q <- params$quantile
cycles <- params$cycles
subgroup <- params$subgroup

con <- connect_pewas_data(db_path)
on.exit(disconnect_pewas_data(con), add = TRUE)

if (is.null(cycles)) {
  tab_info <- get_table_names_for_varname(con, variable)
  yr2s <- c("1999"="A","2001"="B","2003"="C","2005"="D","2007"="E","2009"="F","2011"="G","2013"="H","2015"="I","2017"="J")
  cycles <- tail(sort(unique(yr2s[as.character(tab_info$Begin.Year)])), 1)
}

tryCatch({
  all_data <- NULL
  for (s in cycles) {
    tab_obj <- tryCatch(get_tables(variable, variable, s, con), error = function(e) NULL)
    if (is.null(tab_obj)) next
    tab_obj <- figure_out_weight(tab_obj)
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

  dat <- all_data %>% filter(!is.na(wt), wt > 0, !is.na(.data[[variable]]))
  if (!is.null(subgroup) && nzchar(subgroup)) {
    dat <- dat %>% filter(eval(parse(text = subgroup)))
  }

  n_cycles <- length(cycles)
  if (n_cycles > 1) dat$wt <- dat$wt / n_cycles

  options(survey.lonely.psu = "adjust")
  dsn <- svydesign(ids = ~SDMVPSU, strata = ~SDMVSTRA, weights = ~wt, nest = TRUE, data = dat)

  form <- as.formula(paste0("~", variable))
  result <- svyquantile(form, dsn, quantiles = q, na.rm = TRUE, ci = TRUE)

  # Extract the quantile value — handle different survey package return formats
  qval <- tryCatch({
    # Newer survey package: result is a list of newsvyquantile objects
    r <- result[[1]]
    if (is.matrix(r) || is.array(r)) as.numeric(r[1, 1])
    else as.numeric(r[1])
  }, error = function(e) {
    as.numeric(coef(result)[1])
  })

  # Try to get CI
  ci_lo <- NA
  ci_hi <- NA
  tryCatch({
    ci_obj <- confint(result)
    if (is.matrix(ci_obj) && nrow(ci_obj) >= 1) {
      ci_lo <- ci_obj[1, 1]
      ci_hi <- ci_obj[1, 2]
    }
  }, error = function(e) {})

  output <- list(
    variable = variable,
    quantile = q,
    value = round(qval, 6),
    ci_lower = if (!is.na(ci_lo)) round(ci_lo, 6) else NULL,
    ci_upper = if (!is.na(ci_hi)) round(ci_hi, 6) else NULL,
    n_unweighted = nrow(dat),
    cycles_used = cycles
  )

  cat(toJSON(output, auto_unbox = TRUE, null = "null"))

}, error = function(e) {
  cat(toJSON(list(error = conditionMessage(e)), auto_unbox = TRUE))
  quit(status = 1)
})
