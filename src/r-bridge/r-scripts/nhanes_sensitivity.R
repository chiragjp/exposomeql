#!/usr/bin/env Rscript
# Multi-cycle pooled sensitivity analysis for ExposomeQL.
# Fits a single model-6-style adjustment (age + sex + ethnicity) on pooled
# NHANES cycles, with optional subgroup filter and additional adjustment covariates
# (e.g., disease indicators for reverse-causality sensitivity).

suppressPackageStartupMessages({
  library(jsonlite)
  library(survey)
  library(DBI)
  library(RSQLite)
  library(dplyr)
  library(broom)
})

nhanespewas_path <- Sys.getenv("NHANESPEWAS_PATH")
if (!isNamespaceLoaded("nhanespewas")) {
  if (nzchar(nhanespewas_path) && file.exists(file.path(nhanespewas_path, "DESCRIPTION")) && requireNamespace("devtools", quietly = TRUE)) {
    suppressPackageStartupMessages(devtools::load_all(nhanespewas_path, quiet = TRUE))
  } else {
    suppressPackageStartupMessages(library(nhanespewas))
  }
}

# Null-coalesce operator — `%||%` is base R in 4.4+; define a fallback so this
# script works on older R too.
if (!exists("%||%")) {
  `%||%` <- function(a, b) if (is.null(a) || length(a) == 0) b else a
}

params <- if (exists("POOL_PARAMS", envir = globalenv())) get("POOL_PARAMS", envir = globalenv()) else fromJSON(file("stdin"))
db_path <- Sys.getenv("EXPOSOMEQL_DB_PATH")

exposure   <- params$exposure
outcome    <- params$outcome
cycles     <- params$cycles                  # chr vector of series letters, or NULL
subgroup   <- params$subgroup                # R expression string, or NULL
extra_covs <- params$additional_covariates   # chr vector, or NULL

con <- connect_pewas_data(db_path)
# on.exit removed for pool compatibility; cleanup handled in tryCatch finally

if (is.null(cycles) || length(cycles) == 0) {
  tab_info <- get_table_names_for_varname(con, exposure)
  yr2s <- c("1999"="A","2001"="B","2003"="C","2005"="D","2007"="E","2009"="F",
            "2011"="G","2013"="H","2015"="I","2017"="J")
  cycles <- tail(sort(unique(yr2s[as.character(tab_info$Begin.Year)])), 1)
}

yr_from_letter <- c("A"=1999,"B"=2001,"C"=2003,"D"=2005,"E"=2007,"F"=2009,
                    "G"=2011,"H"=2013,"I"=2015,"J"=2017)

tryCatch({
  pooled <- NULL

  for (s in cycles) {
    tab_obj <- tryCatch(get_tables(exposure, outcome, s, con), error = function(e) NULL)
    if (is.null(tab_obj) || is.null(tab_obj$merged_tab) || nrow(tab_obj$merged_tab) == 0) next
    tab_obj <- figure_out_weight(tab_obj)
    dat <- tab_obj$merged_tab
    dat$series <- s

    # Cycle-specific merge for extra covariates (disease indicators, BMI, etc.)
    if (length(extra_covs) > 0 && "SEQN" %in% names(dat)) {
      missing_here <- setdiff(extra_covs, names(dat))
      for (mv in missing_here) {
        tinfo <- tryCatch(get_table_names_for_varname(con, mv), error = function(e) NULL)
        if (is.null(tinfo) || nrow(tinfo) == 0) next
        # Skip pandemic pre-release tables — different weighting, can't be pooled with A-J.
        tinfo <- tinfo[!grepl("^P_", tinfo$Data.File.Name), ]
        if (nrow(tinfo) == 0) next
        yr <- yr_from_letter[s]
        trow <- tinfo[!is.na(tinfo$Begin.Year) & tinfo$Begin.Year == yr, ]
        if (nrow(trow) == 0) next
        extra <- tryCatch(DBI::dbReadTable(con, trow$Data.File.Name[1]), error = function(e) NULL)
        if (is.null(extra) || !(mv %in% names(extra)) || !("SEQN" %in% names(extra))) next
        dat <- merge(dat, extra[, c("SEQN", mv), drop = FALSE], by = "SEQN", all.x = TRUE)
      }
    }

    if (is.null(pooled)) {
      pooled <- dat
    } else {
      common_cols <- intersect(names(pooled), names(dat))
      pooled <- rbind(pooled[, common_cols, drop = FALSE], dat[, common_cols, drop = FALSE])
    }
  }

  if (is.null(pooled) || nrow(pooled) == 0) {
    cat(toJSON(list(error = "No data found for specified cycles"), auto_unbox = TRUE))
    quit(status = 1)
  }

  # Apply subgroup filter (e.g., disease-exclusion expression). Evaluated in the
  # context of the pooled data frame; NAs in the mask are treated as FALSE so
  # that missing disease indicators don't propagate into silently dropped rows
  # for unrelated reasons.
  if (!is.null(subgroup) && nzchar(subgroup)) {
    mask <- tryCatch(eval(parse(text = subgroup), envir = pooled), error = function(e) NULL)
    if (is.null(mask)) {
      cat(toJSON(list(error = paste0("Failed to evaluate subgroup expression: ", subgroup)), auto_unbox = TRUE))
      quit(status = 1)
    }
    mask[is.na(mask)] <- FALSE
    pooled <- pooled[mask, , drop = FALSE]
  }

  # Weight adjustment for multi-cycle pooling per NCHS guidance.
  # A+B pooled: use WTMEC4YR if present. Otherwise: wt / n_cycles.
  cycles_present <- unique(pooled$series)
  n_cycles <- length(cycles_present)
  if (n_cycles > 1) {
    if (n_cycles == 2 && all(c("A","B") %in% cycles_present) && "WTMEC4YR" %in% names(pooled)) {
      pooled$wt <- pooled$WTMEC4YR
    } else {
      pooled$wt <- pooled$wt / n_cycles
    }
  }

  # Drop rows missing any model input. This is the step that determines n.
  required_design <- c("wt", "SDMVPSU", "SDMVSTRA")
  required_covs   <- c("RIDAGEYR", "RIAGENDR", "RIDRETH1")
  extra_present   <- intersect(extra_covs %||% character(), names(pooled))
  required <- unique(c(exposure, outcome, required_design, required_covs, extra_present))
  required <- intersect(required, names(pooled))
  pooled <- pooled[complete.cases(pooled[, required, drop = FALSE]), , drop = FALSE]
  pooled <- pooled[pooled$wt > 0, , drop = FALSE]

  # NCHS cell-size guardrail
  if (nrow(pooled) < 30) {
    cat(toJSON(list(error = paste0("Insufficient sample size after filtering (n=", nrow(pooled), "). NCHS minimum is 30.")), auto_unbox = TRUE))
    quit(status = 1)
  }

  # Log10 + z-score the exposure (matches pe_flex_adjust's continuous handling).
  expo_raw <- pooled[[exposure]]
  if (any(expo_raw <= 0, na.rm = TRUE)) {
    # Shift to avoid log(0)/log(-); nhanespewas uses log10 directly and discards <=0.
    pooled <- pooled[expo_raw > 0, , drop = FALSE]
    expo_raw <- pooled[[exposure]]
    if (nrow(pooled) < 30) {
      cat(toJSON(list(error = paste0("Insufficient sample size after dropping non-positive exposures (n=", nrow(pooled), ").")), auto_unbox = TRUE))
      quit(status = 1)
    }
  }
  pooled$expo <- as.numeric(scale(log10(expo_raw)))

  # Factor categorical covariates
  pooled$RIAGENDR <- as.factor(pooled$RIAGENDR)
  pooled$RIDRETH1 <- as.factor(pooled$RIDRETH1)
  for (v in extra_present) {
    vals <- pooled[[v]]
    if (length(unique(vals[!is.na(vals)])) <= 10) {
      pooled[[v]] <- as.factor(pooled[[v]])
    }
  }

  # Formula: model-6 baseline + additional covariates
  fixed_terms <- c("expo", "RIDAGEYR", "RIAGENDR", "RIDRETH1")
  all_terms <- c(fixed_terms, extra_present)
  fml <- as.formula(paste0("`", outcome, "` ~ ", paste(all_terms, collapse = " + ")))

  options(survey.lonely.psu = "adjust")
  dsn <- svydesign(ids = ~SDMVPSU, strata = ~SDMVSTRA, weights = ~wt,
                   nest = TRUE, data = pooled)
  fit <- svyglm(fml, design = dsn)

  tidied <- tidy(fit, conf.int = TRUE)
  expo_row <- tidied[tidied$term == "expo", ]
  if (nrow(expo_row) == 0) {
    cat(toJSON(list(error = "Exposure coefficient not found after fit"), auto_unbox = TRUE))
    quit(status = 1)
  }

  finite_or_null <- function(x) {
    x <- as.numeric(x)
    if (is.na(x) || !is.finite(x)) NULL else x
  }

  model6 <- list(
    estimate  = finite_or_null(round(expo_row$estimate[1], 6)),
    std_error = finite_or_null(round(expo_row$std.error[1], 6)),
    statistic = finite_or_null(round(expo_row$statistic[1], 4)),
    p_value   = finite_or_null(expo_row$p.value[1]),
    ci_lower  = finite_or_null(round(expo_row$conf.low[1], 6)),
    ci_upper  = finite_or_null(round(expo_row$conf.high[1], 6)),
    n         = nrow(pooled)
  )

  output <- list(
    model_6   = model6,
    exposure  = exposure,
    outcome   = outcome,
    cycles_used = cycles_present,
    n_cycles  = n_cycles,
    pooling_note = if (n_cycles == 1) "single cycle"
                   else if (n_cycles == 2 && all(c("A","B") %in% cycles_present) && "WTMEC4YR" %in% names(pooled)) "A+B pooled via WTMEC4YR"
                   else paste0(n_cycles, " cycles pooled; weights divided by ", n_cycles),
    subgroup_applied = !is.null(subgroup) && nzchar(subgroup),
    additional_covariates = if (length(extra_present) > 0) extra_present else NULL,
    note = "Exposure is log10-transformed and z-scored; beta is change in outcome per 1-SD change in log10(exposure). Covariates: age + sex + ethnicity + any requested extras."
  )

  cat(toJSON(output, auto_unbox = TRUE, null = "null", na = "null"))

}, error = function(e) {
  cat(toJSON(list(error = conditionMessage(e)), auto_unbox = TRUE))
  quit(status = 1)
}, finally = {
  try(disconnect_pewas_data(con), silent = TRUE)
})
