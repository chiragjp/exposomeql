#!/usr/bin/env Rscript
# Survey-weighted correlation for ExposomeQL
# Computes Pearson correlation with CI using survey-weighted covariance

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

var1 <- params$var1
var2 <- params$var2
cycles <- params$cycles
subgroup <- params$subgroup

con <- connect_pewas_data(db_path)
# on.exit removed for pool compatibility; cleanup handled in tryCatch finally

if (is.null(cycles)) {
  tab_info <- get_table_names_for_varname(con, var1)
  yr2s <- c("1999"="A","2001"="B","2003"="C","2005"="D","2007"="E","2009"="F","2011"="G","2013"="H","2015"="I","2017"="J")
  cycles <- tail(sort(unique(yr2s[as.character(tab_info$Begin.Year)])), 1)
}

tryCatch({
  all_data <- NULL
  for (s in cycles) {
    tab_obj <- tryCatch(get_tables(var1, var2, s, con), error = function(e) NULL)
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

  dat <- all_data %>% filter(!is.na(wt), wt > 0, !is.na(.data[[var1]]), !is.na(.data[[var2]]))
  if (!is.null(subgroup) && nzchar(subgroup)) {
    dat <- dat %>% filter(eval(parse(text = subgroup)))
  }

  n_cycles <- length(cycles)
  if (n_cycles > 1) dat$wt <- dat$wt / n_cycles

  options(survey.lonely.psu = "adjust")
  dsn <- svydesign(ids = ~SDMVPSU, strata = ~SDMVSTRA, weights = ~wt, nest = TRUE, data = dat)

  # Survey-weighted Pearson correlation via regression
  # r = beta * (sd_x / sd_y) where beta comes from svyglm(y ~ x)
  form <- as.formula(paste0(var2, " ~ ", var1))
  fit <- svyglm(form, design = dsn)
  tidied <- broom::tidy(fit, conf.int = TRUE)

  # Extract coefficient for var1
  var1_row <- tidied[tidied$term == var1, ]

  # Compute survey-weighted variances
  var_mat <- svyvar(as.formula(paste0("~", var1, "+", var2)), dsn, na.rm = TRUE)
  var1_var <- as.numeric(var_mat[1, 1])
  var2_var <- as.numeric(var_mat[2, 2])

  if (var1_var <= 0 || var2_var <= 0) {
    cat(toJSON(list(error = paste0("Zero variance detected: ",
      if (var1_var <= 0) paste0(var1, " (var=", round(var1_var, 6), ")") else "",
      if (var1_var <= 0 && var2_var <= 0) " and " else "",
      if (var2_var <= 0) paste0(var2, " (var=", round(var2_var, 6), ")") else "",
      ". Correlation is undefined for constant variables."
    )), auto_unbox = TRUE))
    quit(status = 0)
  }

  beta <- as.numeric(var1_row$estimate)
  pearson_r <- beta * sqrt(var1_var / var2_var)

  # R-squared from regression
  ss_total <- var2_var * (nrow(dat) - 1)

  # Fisher z-transform CI for correlation
  n <- nrow(dat)
  if (n <= 3) {
    cat(toJSON(list(error = paste0("Insufficient sample size (n=", n, ") for correlation CI. Need n > 3.")), auto_unbox = TRUE))
    quit(status = 0)
  }
  # Clamp pearson_r to (-1, 1) to avoid atanh(±1) → Inf
  pearson_r_clamped <- max(-0.9999999, min(0.9999999, pearson_r))
  z_r <- atanh(pearson_r_clamped)
  se_z <- 1 / sqrt(n - 3)
  ci_lo <- tanh(z_r - 1.96 * se_z)
  ci_hi <- tanh(z_r + 1.96 * se_z)

  # Also compute Spearman via ranks
  dat$rank1 <- rank(dat[[var1]])
  dat$rank2 <- rank(dat[[var2]])
  dsn_rank <- svydesign(ids = ~SDMVPSU, strata = ~SDMVSTRA, weights = ~wt, nest = TRUE, data = dat)
  fit_rank <- svyglm(rank2 ~ rank1, design = dsn_rank)
  beta_rank <- coef(fit_rank)["rank1"]
  var_rank <- svyvar(~rank1 + rank2, dsn_rank, na.rm = TRUE)
  spearman_r <- as.numeric(beta_rank) * sqrt(as.numeric(var_rank[1, 1]) / as.numeric(var_rank[2, 2]))

  output <- list(
    var1 = var1,
    var2 = var2,
    pearson = list(
      r = round(pearson_r, 6),
      ci_lower = round(ci_lo, 6),
      ci_upper = round(ci_hi, 6)
    ),
    spearman = list(
      r = round(spearman_r, 6)
    ),
    regression = list(
      beta = round(beta, 6),
      se = round(as.numeric(var1_row$std.error), 6),
      p_value = as.numeric(var1_row$p.value),
      ci_lower = round(as.numeric(var1_row$conf.low), 6),
      ci_upper = round(as.numeric(var1_row$conf.high), 6)
    ),
    n_unweighted = nrow(dat),
    cycles_used = cycles
  )

  cat(toJSON(output, auto_unbox = TRUE, null = "null"))

}, error = function(e) {
  cat(toJSON(list(error = conditionMessage(e)), auto_unbox = TRUE))
  quit(status = 1)
}, finally = {
  try(disconnect_pewas_data(con), silent = TRUE)
})
