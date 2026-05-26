#!/usr/bin/env Rscript
# ExWAS sweep against a derived-phenotype outcome.
#
# Loops over a caller-supplied exposure list and fits one survey-weighted
# regression per exposure (model 6: age + age² + sex + ethnicity). Continuous
# exposures get log10 + scale; categorical use largest-level reference.
#
# Source-agnostic: the outcome and design columns come from a handle CSV. If
# the CSV lacks survey-design columns, fits fall back to plain glm() for
# future non-NHANES cohort handles.

suppressPackageStartupMessages({
  library(jsonlite)
  library(survey)
  library(DBI)
  library(RSQLite)
  library(dplyr)
  library(broom)
})

`%||%` <- function(a, b) if (is.null(a) || (is.character(a) && !nzchar(a))) b else a

params <- if (exists("POOL_PARAMS", envir = globalenv())) get("POOL_PARAMS", envir = globalenv()) else fromJSON(file("stdin"))
db_path <- Sys.getenv("EXPOSOMEQL_DB_PATH")

handle_csv     <- params$phenotype_handle_csv
outcome_name   <- params$outcome_name %||% "derived_phenotype"
exposures      <- params$exposures
phenotype_type <- params$phenotype_type %||% "continuous"
id_col         <- params$id_column     %||% "SEQN"
wt_col         <- params$weight_column %||% "wt_pooled"
psu_col        <- params$psu_column    %||% "SDMVPSU"
str_col        <- params$strata_column %||% "SDMVSTRA"
has_survey     <- isTRUE(params$has_survey_design)

if (is.null(handle_csv) || !file.exists(handle_csv)) {
  cat(toJSON(list(error = "phenotype handle CSV not found"), auto_unbox = TRUE)); quit(status = 1)
}
if (is.null(exposures) || length(exposures) == 0) {
  cat(toJSON(list(error = "No exposures provided"), auto_unbox = TRUE)); quit(status = 1)
}

is_binary <- phenotype_type == "binary"

con <- dbConnect(SQLite(), db_path)
handle <- read.csv(handle_csv)
names(handle)[names(handle) == "value"] <- outcome_name
has_cycle <- "cycle" %in% names(handle)
cycles <- if (has_cycle) unique(handle$cycle) else character(0)

yr2s <- c("A"=1999,"B"=2001,"C"=2003,"D"=2005,"E"=2007,"F"=2009,
          "G"=2011,"H"=2013,"I"=2015,"J"=2017)

# Pre-stack each exposure across requested cycles. For NHANES, the catalog
# routes each variable to the right per-cycle table. Returns NULL if no rows.
load_exposure <- function(expo) {
  cat_info <- tryCatch(
    dbGetQuery(con,
      'SELECT "Data.File.Name" AS f, "Begin.Year" AS y FROM variable_names_epcf WHERE "Variable.Name"=?',
      params = list(expo)),
    error = function(e) NULL
  )
  if (is.null(cat_info) || nrow(cat_info) == 0) return(NULL)
  cat_info <- cat_info[!grepl("^P_", cat_info$f), ]
  if (nrow(cat_info) == 0) return(NULL)
  if (!has_cycle) {
    tab <- tryCatch(dbReadTable(con, cat_info$f[1]), error = function(e) NULL)
    if (is.null(tab) || !(expo %in% names(tab)) || !(id_col %in% names(tab))) return(NULL)
    return(tab[, c(id_col, expo)])
  }
  out <- NULL
  for (s in cycles) {
    yr <- yr2s[s]
    row <- cat_info[!is.na(cat_info$y) & cat_info$y == yr, ]
    if (nrow(row) == 0) next
    tab <- tryCatch(dbReadTable(con, row$f[1]), error = function(e) NULL)
    if (is.null(tab) || !(expo %in% names(tab)) || !(id_col %in% names(tab))) next
    sub <- tab[, c(id_col, expo)]
    sub$cycle <- s
    out <- rbind(out, sub)
  }
  out
}

options(survey.lonely.psu = "adjust")

results <- list()
errors <- character()

fit_one <- function(expo) {
  edat <- load_exposure(expo)
  if (is.null(edat) || nrow(edat) == 0) return(list(status = "skip", reason = "no data"))
  merge_keys <- if (has_cycle && "cycle" %in% names(edat)) c(id_col, "cycle") else id_col
  m <- merge(handle, edat, by = merge_keys, all.x = FALSE, all.y = FALSE)
  m <- m[!is.na(m[[outcome_name]]) & !is.na(m[[expo]]), ]
  if (has_survey && wt_col %in% names(m)) m <- m[!is.na(m[[wt_col]]) & m[[wt_col]] > 0, ]
  if (nrow(m) < 30) return(list(status = "skip", reason = paste0("n<30 after merge (got ", nrow(m), ")")))

  ev <- m[[expo]]
  n_unique <- length(unique(ev[!is.na(ev)]))
  is_categorical <- n_unique <= 5 && all(ev[!is.na(ev)] %% 1 == 0)

  if (is_categorical) {
    m[[expo]] <- as.factor(m[[expo]])
    tab <- sort(table(m[[expo]]), decreasing = TRUE)
    m[[expo]] <- relevel(m[[expo]], ref = names(tab)[1])
    expo_term <- expo
  } else {
    pos <- ev[!is.na(ev) & ev > 0]
    eps <- if (length(pos) > 0) min(pos) / 2 else 1e-6
    m$expo_t <- as.numeric(scale(log10(pmax(ev, 0) + eps)))
    expo_term <- "expo_t"
  }

  covariates <- c()
  if ("RIDAGEYR" %in% names(m)) covariates <- c(covariates, "RIDAGEYR", "I(RIDAGEYR^2)")
  if ("RIAGENDR" %in% names(m)) { m$RIAGENDR <- as.factor(m$RIAGENDR); covariates <- c(covariates, "RIAGENDR") }
  if ("RIDRETH3" %in% names(m)) { m$RIDRETH3 <- as.factor(m$RIDRETH3); covariates <- c(covariates, "RIDRETH3") }

  fml <- as.formula(paste0(outcome_name, " ~ ", paste(c(expo_term, covariates), collapse = " + ")))
  use_survey <- has_survey && all(c(psu_col, str_col, wt_col) %in% names(m))

  fit <- if (use_survey) {
    dsn <- svydesign(
      ids = as.formula(paste0("~", psu_col)),
      strata = as.formula(paste0("~", str_col)),
      weights = as.formula(paste0("~", wt_col)),
      nest = TRUE, data = m)
    if (is_binary) svyglm(fml, design = dsn, family = quasibinomial())
    else svyglm(fml, design = dsn)
  } else {
    if (is_binary) glm(fml, data = m, family = binomial())
    else lm(fml, data = m)
  }

  tidied <- tidy(fit)
  pattern <- paste0("^", if (is_categorical) expo else expo_term)
  expo_rows <- tidied[grepl(pattern, tidied$term), , drop = FALSE]
  if (nrow(expo_rows) == 0) return(list(status = "skip", reason = "no exposure coefficient"))
  if (nrow(expo_rows) > 1) expo_rows <- expo_rows[order(expo_rows$p.value), , drop = FALSE]
  r <- expo_rows[1, ]
  list(
    status = "ok",
    record = list(
      exposure = expo,
      term = r$term,
      estimate = round(as.numeric(r$estimate), 6),
      std_error = round(as.numeric(r$std.error), 6),
      p_value = as.numeric(r$p.value),
      n = nrow(m),
      exposure_type = if (is_categorical) "categorical" else "continuous",
      survey_weighted = use_survey
    )
  )
}

tryCatch({
  for (expo in exposures) {
    outcome <- tryCatch(fit_one(expo), error = function(e) list(status = "err", reason = conditionMessage(e)))
    if (is.null(outcome) || identical(outcome$status, "err")) {
      errors <- c(errors, paste0(expo, ": ", outcome$reason %||% "unknown error"))
    } else if (identical(outcome$status, "skip")) {
      errors <- c(errors, paste0(expo, ": ", outcome$reason))
    } else if (identical(outcome$status, "ok")) {
      results[[length(results) + 1]] <- outcome$record
    }
  }

  # Sort by p-value, annotate Bonferroni + BH-FDR
  if (length(results) > 0) {
    pvals <- vapply(results, function(x) x$p_value, numeric(1))
    ord <- order(pvals)
    results <- results[ord]
    n_tests <- length(results)
    sorted_p <- pvals[ord]
    bonf <- pmin(sorted_p * n_tests, 1)
    bh <- p.adjust(sorted_p, method = "BH")
    for (i in seq_along(results)) {
      results[[i]]$p_bonferroni <- bonf[i]
      results[[i]]$p_fdr_bh <- bh[i]
    }
  }

  cat(toJSON(list(
    outcome = outcome_name,
    phenotype_type = phenotype_type,
    n_exposures_tested = length(exposures),
    n_results = length(results),
    n_errors = length(errors),
    cycles_used = cycles,
    survey_weighted_default = has_survey,
    results = results,
    errors = if (length(errors) > 0) errors else NULL,
    note = "Adjustment: age + age^2 + sex + ethnicity (model 6). Continuous exposures: log10 + z-scored. Categorical: largest level as reference."
  ), auto_unbox = TRUE, null = "null"))
}, error = function(e) {
  cat(toJSON(list(error = conditionMessage(e)), auto_unbox = TRUE))
  quit(status = 1)
}, finally = {
  try(dbDisconnect(con), silent = TRUE)
})
