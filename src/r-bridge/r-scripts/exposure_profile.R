#!/usr/bin/env Rscript
# exposure_profile.R
# Compute population-wide and subgroup-specific survey-weighted exposure distributions.
# Returns both distributions plus log10 summary stats for EP-WAS contextualization.

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
cycles   <- params$cycles
subgroup <- params$subgroup  # demographic filter expression

con <- connect_pewas_data(db_path)
on.exit(disconnect_pewas_data(con), add = TRUE)

# Auto-detect cycles if not specified
if (is.null(cycles)) {
  tab_info <- get_table_names_for_varname(con, variable)
  if (nrow(tab_info) == 0) {
    cat(toJSON(list(error = paste0("Variable ", variable, " not found")), auto_unbox = TRUE))
    quit(status = 0)
  }
  yr2s <- c("1999"="A","2001"="B","2003"="C","2005"="D","2007"="E","2009"="F","2011"="G","2013"="H","2015"="I","2017"="J")
  cycles <- tail(sort(unique(yr2s[as.character(tab_info$Begin.Year)])), 3)
}

compute_distribution <- function(dat, variable, label) {
  if (nrow(dat) < 5) {
    return(list(
      label = label,
      error = paste0("Insufficient data (n=", nrow(dat), ")"),
      n_unweighted = nrow(dat)
    ))
  }

  options(survey.lonely.psu = "adjust")
  dsn <- svydesign(ids = ~SDMVPSU, strata = ~SDMVSTRA, weights = ~wt, nest = TRUE, data = dat)

  probs <- c(0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95)
  form <- as.formula(paste0("~", variable))

  # Percentiles
  quants <- tryCatch(svyquantile(form, dsn, quantiles = probs, na.rm = TRUE), error = function(e) NULL)
  qvals <- NULL
  if (!is.null(quants)) {
    qvals <- tryCatch({
      r <- quants[[1]]
      if (is.matrix(r) || is.array(r)) {
        v <- as.numeric(r[, 1])
        if (length(v) == length(probs)) v else as.numeric(r[1:length(probs)])
      } else {
        as.numeric(r[1:length(probs)])
      }
    }, error = function(e) as.numeric(coef(quants)[1:length(probs)]))
    names(qvals) <- paste0("p", probs * 100)
  }

  # Mean + SE
  mean_result <- tryCatch(svymean(form, dsn, na.rm = TRUE), error = function(e) NULL)

  # Geometric mean for biomarkers
  geometric_mean <- NULL
  if (grepl("^(LBX|URX)", variable)) {
    dat_pos <- dat %>% filter(.data[[variable]] > 0)
    if (nrow(dat_pos) > 5) {
      dsn_pos <- svydesign(ids = ~SDMVPSU, strata = ~SDMVSTRA, weights = ~wt, nest = TRUE, data = dat_pos)
      log_mean <- tryCatch(
        coef(svymean(as.formula(paste0("~log(", variable, ")")), dsn_pos, na.rm = TRUE)),
        error = function(e) NA
      )
      if (!is.na(log_mean)) geometric_mean <- round(exp(log_mean), 6)
    }
  }

  # Log10 statistics for EP-WAS contextualization
  vals <- dat[[variable]]
  pos_vals <- vals[vals > 0 & !is.na(vals)]
  log10_mean <- NULL
  log10_sd <- NULL
  if (length(pos_vals) > 5) {
    lv <- log10(pos_vals)
    log10_mean <- round(mean(lv), 6)
    log10_sd <- round(sd(lv), 6)
  }

  # LOD: count values <= 0 or with comment code
  pct_below_lod <- NULL
  lod_comment_var <- sub("^LBX", "LBD", variable)
  lod_comment_var <- paste0(lod_comment_var, "LC")
  if (lod_comment_var %in% names(dat)) {
    n_below <- sum(dat[[lod_comment_var]] == 1, na.rm = TRUE)
    pct_below_lod <- round(100 * n_below / nrow(dat), 1)
  }

  result <- list(
    label = label,
    n_unweighted = nrow(dat),
    mean = if (!is.null(mean_result)) round(as.numeric(coef(mean_result)), 6) else NULL,
    se = if (!is.null(mean_result)) round(as.numeric(SE(mean_result)), 6) else NULL,
    geometric_mean = geometric_mean,
    percentiles = if (!is.null(qvals)) as.list(round(qvals, 6)) else NULL,
    log10_mean = log10_mean,
    log10_sd = log10_sd,
    pct_below_lod = pct_below_lod,
    min = round(min(vals, na.rm = TRUE), 6),
    max = round(max(vals, na.rm = TRUE), 6)
  )

  return(result)
}

tryCatch({
  # Gather data across cycles
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

  dat_all <- all_data %>% filter(!is.na(wt), wt > 0, !is.na(.data[[variable]]))
  n_cycles <- length(cycles)
  if (n_cycles > 1) dat_all$wt <- dat_all$wt / n_cycles

  # 1. Population-wide distribution
  pop_dist <- compute_distribution(dat_all, variable, "population")

  # 2. Subgroup-specific distribution
  subgroup_dist <- NULL
  if (!is.null(subgroup) && nzchar(subgroup)) {
    dat_sub <- tryCatch(
      dat_all %>% filter(eval(parse(text = subgroup))),
      error = function(e) {
        NULL
      }
    )
    if (!is.null(dat_sub) && nrow(dat_sub) > 0) {
      subgroup_dist <- compute_distribution(dat_sub, variable, "subgroup")
      subgroup_dist$filter_applied <- subgroup
    } else {
      subgroup_dist <- list(
        label = "subgroup",
        error = "No observations match the demographic filter",
        filter_applied = subgroup,
        n_unweighted = 0
      )
    }
  }

  # Available demographic columns for reference
  demo_cols <- intersect(
    c("RIDAGEYR", "RIAGENDR", "RIDRETH1", "RIDRETH3", "BMXBMI", "INDFMPIR"),
    names(dat_all)
  )
  demo_available <- demo_cols

  output <- list(
    variable = variable,
    cycles_used = cycles,
    weight_used = if ("wt_name" %in% names(attributes(dat_all))) attr(dat_all, "wt_name") else "WTMEC2YR",
    population = pop_dist,
    subgroup = subgroup_dist,
    demographic_columns_available = demo_available
  )

  cat(toJSON(output, auto_unbox = TRUE, null = "null"))

}, error = function(e) {
  cat(toJSON(list(error = conditionMessage(e)), auto_unbox = TRUE))
  quit(status = 1)
})
