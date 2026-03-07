#!/usr/bin/env Rscript
# Survey-weighted population count for ExposomeQL
# Estimates population count meeting a condition

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

condition <- params$condition
cycles <- params$cycles
subgroup <- params$subgroup

# Extract variable name from condition
var_match <- regmatches(condition, regexpr("[A-Z][A-Z0-9_]+", condition))
if (length(var_match) == 0) {
  cat(toJSON(list(error = "Could not extract variable name from condition"), auto_unbox = TRUE))
  quit(status = 1)
}
variable <- var_match[1]

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

  dat$meets_condition <- as.numeric(eval(parse(text = condition), envir = dat))

  options(survey.lonely.psu = "adjust")
  dsn <- svydesign(ids = ~SDMVPSU, strata = ~SDMVSTRA, weights = ~wt, nest = TRUE, data = dat)

  total_result <- svytotal(~meets_condition, dsn, na.rm = TRUE)
  est <- as.numeric(coef(total_result))
  se_val <- as.numeric(SE(total_result))
  ci_lo <- est - 1.96 * se_val
  ci_hi <- est + 1.96 * se_val

  # Total population in the subgroup
  total_pop <- sum(dat$wt)

  output <- list(
    condition = condition,
    population_count = round(est),
    se = round(se_val),
    ci_lower = round(ci_lo),
    ci_upper = round(ci_hi),
    total_population = round(total_pop),
    n_unweighted = nrow(dat),
    n_meeting_condition = sum(dat$meets_condition, na.rm = TRUE),
    cycles_used = cycles
  )

  cat(toJSON(output, auto_unbox = TRUE, null = "null"))

}, error = function(e) {
  cat(toJSON(list(error = conditionMessage(e)), auto_unbox = TRUE))
  quit(status = 1)
})
