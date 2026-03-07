#!/usr/bin/env Rscript
# Survey-weighted distribution for ExposomeQL
# Returns percentiles, geometric mean, histogram bins

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
cycles <- params$cycles
subgroup <- params$subgroup

con <- connect_pewas_data(db_path)
on.exit(disconnect_pewas_data(con), add = TRUE)

if (is.null(cycles)) {
  tab_info <- get_table_names_for_varname(con, variable)
  if (nrow(tab_info) == 0) {
    cat(toJSON(list(error = paste0("Variable ", variable, " not found")), auto_unbox = TRUE))
    quit(status = 0)
  }
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

  # Percentiles
  probs <- c(0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95)
  form <- as.formula(paste0("~", variable))
  quants <- svyquantile(form, dsn, quantiles = probs, na.rm = TRUE)

  # Extract quantile values — handle different survey package return formats
  qvals <- tryCatch({
    r <- quants[[1]]
    if (is.matrix(r) || is.array(r)) {
      v <- as.numeric(r[, 1])
      if (length(v) == length(probs)) v
      else as.numeric(r[1:length(probs)])
    } else {
      as.numeric(r[1:length(probs)])
    }
  }, error = function(e) {
    as.numeric(coef(quants)[1:length(probs)])
  })
  names(qvals) <- paste0("p", probs * 100)

  # Mean and SE
  mean_result <- svymean(form, dsn, na.rm = TRUE)

  # Geometric mean for biomarkers
  geometric_mean <- NULL
  if (grepl("^(LBX|URX)", variable)) {
    dat_pos <- dat %>% filter(.data[[variable]] > 0)
    if (nrow(dat_pos) > 0) {
      dsn_pos <- svydesign(ids = ~SDMVPSU, strata = ~SDMVSTRA, weights = ~wt, nest = TRUE, data = dat_pos)
      log_mean <- tryCatch(
        coef(svymean(as.formula(paste0("~log(", variable, ")")), dsn_pos, na.rm = TRUE)),
        error = function(e) NA
      )
      if (!is.na(log_mean)) geometric_mean <- round(exp(log_mean), 6)
    }
  }

  # Histogram bins (20 bins)
  vals <- dat[[variable]]
  val_min <- min(vals, na.rm = TRUE)
  val_max <- max(vals, na.rm = TRUE)
  if (val_min == val_max) {
    # All values identical — return single-bin histogram
    hist_data <- list(
      breaks = c(val_min - 0.5, val_max + 0.5),
      counts = length(vals),
      mids = val_min
    )
  } else {
    breaks_hist <- seq(val_min, val_max, length.out = 21)
    hist_data <- hist(vals, breaks = breaks_hist, plot = FALSE)
  }

  output <- list(
    variable = variable,
    mean = round(as.numeric(coef(mean_result)), 6),
    se = round(as.numeric(SE(mean_result)), 6),
    geometric_mean = geometric_mean,
    percentiles = as.list(round(qvals, 6)),
    min = round(min(vals, na.rm = TRUE), 6),
    max = round(max(vals, na.rm = TRUE), 6),
    histogram = list(
      breaks = round(hist_data$breaks, 4),
      counts = hist_data$counts,
      mids = round(hist_data$mids, 4)
    ),
    n_unweighted = nrow(dat),
    cycles_used = cycles
  )

  cat(toJSON(output, auto_unbox = TRUE, null = "null"))

}, error = function(e) {
  cat(toJSON(list(error = conditionMessage(e)), auto_unbox = TRUE))
  quit(status = 1)
})
