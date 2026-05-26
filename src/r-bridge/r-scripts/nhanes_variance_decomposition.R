#!/usr/bin/env Rscript
# Multivariate variance decomposition: baseline (demo) R² vs expanded (demo +
# top-K exposures) R², the headline figure from the NMI paper's exposome-vs-
# genetic comparison. MICE handles missingness across the assembled exposure
# matrix; coefficients pool via Rubin's rules.
#
# KNOWN ISSUE (2026-05-19): observed matrix-decomposition errors on
# auto_top_k=20 against LBXGLU (fasting glucose). The likely culprit is
# collinearity in the auto-selected exposure set — top EP-WAS hits for a
# cardiometabolic outcome often cluster (PFAS isomers, urinary phthalate
# metabolites, multi-metal panels), which leaves the imputed design matrix
# singular or ill-conditioned in either `mice()` predictor fitting or the
# downstream `lm()`/`svyglm()` solve. Mitigations to consider: (1) drop
# correlated exposures before MICE (|r| > 0.85, keep one representative);
# (2) fall back to ridge / principal-components regression when the
# unregularized solve fails; (3) detect rank deficiency and prune offending
# columns with a warning instead of failing. For now, the failure surfaces
# as an opaque "matrix decomposition" error to the caller — improve the
# error message at minimum. Pulled from the web app's landing chip set in
# the meantime (exposomeqlweb/components/Chat.tsx).

suppressPackageStartupMessages({
  library(jsonlite)
  library(survey)
  library(DBI)
  library(RSQLite)
  library(dplyr)
  library(mice)
  library(mitools)
  library(broom)
})

`%||%` <- function(a, b) {
  if (is.null(a)) return(b)
  if (is.character(a) && length(a) == 1 && !nzchar(a)) return(b)
  a
}

params <- if (exists("POOL_PARAMS", envir = globalenv())) get("POOL_PARAMS", envir = globalenv()) else fromJSON(file("stdin"))
db_path <- Sys.getenv("EXPOSOMEQL_DB_PATH")

# Inputs
handle_csv     <- params$phenotype_handle_csv
outcome_var    <- params$outcome
outcome_name   <- params$outcome_name %||% (if (!is.null(outcome_var)) outcome_var else "derived_phenotype")
phenotype_type <- params$phenotype_type %||% "continuous"
exposures      <- params$exposures
covariates     <- params$covariates %||% c("RIDAGEYR", "I(RIDAGEYR^2)", "RIAGENDR", "RIDRETH3")
imputation     <- params$imputation %||% "mice"
m              <- params$m %||% 5
maxit          <- params$maxit %||% 5
cycles         <- params$cycles
id_col         <- params$id_column     %||% "SEQN"
wt_col         <- params$weight_column %||% "wt_pooled"
psu_col        <- params$psu_column    %||% "SDMVPSU"
str_col        <- params$strata_column %||% "SDMVSTRA"
has_survey     <- isTRUE(params$has_survey_design) || is.null(params$has_survey_design)

if (phenotype_type != "continuous") {
  cat(toJSON(list(error = "variance_decomposition v1 supports continuous outcomes only (R² is only well-defined for continuous outcomes)."), auto_unbox = TRUE))
  quit(status = 1)
}

if (is.null(exposures) || length(exposures) == 0) {
  cat(toJSON(list(error = "exposures list cannot be empty"), auto_unbox = TRUE))
  quit(status = 1)
}

yr2s <- c("A"=1999,"B"=2001,"C"=2003,"D"=2005,"E"=2007,"F"=2009,
          "G"=2011,"H"=2013,"I"=2015,"J"=2017)

con <- dbConnect(SQLite(), db_path)

tryCatch({
  # ─── 1. Outcome side: handle CSV or NHANES variable ───
  if (!is.null(handle_csv) && file.exists(handle_csv)) {
    base <- read.csv(handle_csv)
    names(base)[names(base) == "value"] <- outcome_name
    has_cycle <- "cycle" %in% names(base)
    if (has_cycle) cycles_used <- unique(base$cycle) else cycles_used <- character(0)
  } else if (!is.null(outcome_var) && nzchar(outcome_var)) {
    # NHANES variable path: query catalog → load tables per cycle
    cat_info <- tryCatch(
      dbGetQuery(con,
        'SELECT "Data.File.Name" AS f, "Begin.Year" AS y FROM variable_names_epcf WHERE "Variable.Name"=?',
        params = list(outcome_var)),
      error = function(e) NULL
    )
    if (is.null(cat_info) || nrow(cat_info) == 0) {
      cat(toJSON(list(error = paste0("outcome variable '", outcome_var, "' not in catalog")), auto_unbox = TRUE))
      quit(status = 1)
    }
    cat_info <- cat_info[!grepl("^P_", cat_info$f), ]
    if (is.null(cycles)) cycles <- names(yr2s)
    # Load DEMO + outcome per cycle, stack
    base <- NULL
    has_cycle <- TRUE
    for (s in cycles) {
      yr <- yr2s[s]
      row <- cat_info[!is.na(cat_info$y) & cat_info$y == yr, ]
      if (nrow(row) == 0) next
      demo <- tryCatch(dbReadTable(con, paste0("DEMO_", s)), error = function(e) NULL)
      tab  <- tryCatch(dbReadTable(con, row$f[1]), error = function(e) NULL)
      if (is.null(demo) || is.null(tab) || !(outcome_var %in% names(tab))) next
      demo_keep <- c("SEQN", "RIDAGEYR", "RIAGENDR", "RIDRETH3", "INDFMPIR",
                     "DMDEDUC2", "WTMEC2YR", "SDMVPSU", "SDMVSTRA")
      demo_keep <- intersect(demo_keep, names(demo))
      d <- demo[, demo_keep]
      d$cycle <- s
      d <- merge(d, tab[, c("SEQN", outcome_var)], by = "SEQN", all.x = FALSE)
      # Align columns before rbind — demographic columns (RIDRETH3/INDFMPIR/
      # DMDEDUC2) aren't present in every cycle, which would crash a naive rbind.
      if (is.null(base)) base <- d
      else { cc <- intersect(names(base), names(d)); base <- rbind(base[, cc, drop = FALSE], d[, cc, drop = FALSE]) }
    }
    if (is.null(base) || nrow(base) == 0) {
      cat(toJSON(list(error = paste0("no data found for outcome '", outcome_var, "'")), auto_unbox = TRUE))
      quit(status = 1)
    }
    names(base)[names(base) == outcome_var] <- outcome_name
    # Pool weight (NCHS guidance: divide WTMEC2YR by # cycles)
    n_cycles <- length(unique(base$cycle))
    base$wt_pooled <- base$WTMEC2YR / max(1, n_cycles)
    cycles_used <- unique(base$cycle)
  } else {
    cat(toJSON(list(error = "either outcome or phenotype_handle_csv must be supplied"), auto_unbox = TRUE))
    quit(status = 1)
  }

  # ─── 2. Load each exposure across cycles ───
  exposure_status <- list()
  for (expo in exposures) {
    cat_info <- tryCatch(
      dbGetQuery(con,
        'SELECT "Data.File.Name" AS f, "Begin.Year" AS y FROM variable_names_epcf WHERE "Variable.Name"=?',
        params = list(expo)),
      error = function(e) NULL
    )
    if (is.null(cat_info) || nrow(cat_info) == 0) {
      exposure_status[[expo]] <- "not in catalog"
      next
    }
    cat_info <- cat_info[!grepl("^P_", cat_info$f), ]
    stacked <- NULL
    if (has_cycle) {
      for (s in cycles_used) {
        yr <- yr2s[s]
        row <- cat_info[!is.na(cat_info$y) & cat_info$y == yr, ]
        if (nrow(row) == 0) next
        tab <- tryCatch(dbReadTable(con, row$f[1]), error = function(e) NULL)
        if (is.null(tab) || !(expo %in% names(tab))) next
        sub <- tab[, c(id_col, expo)]
        sub$cycle <- s
        stacked <- rbind(stacked, sub)
      }
      if (!is.null(stacked)) {
        base <- merge(base, stacked, by = c(id_col, "cycle"), all.x = TRUE)
        exposure_status[[expo]] <- "loaded"
      } else {
        exposure_status[[expo]] <- "no overlap with outcome cycles"
      }
    } else {
      tab <- tryCatch(dbReadTable(con, cat_info$f[1]), error = function(e) NULL)
      if (!is.null(tab) && expo %in% names(tab)) {
        base <- merge(base, tab[, c(id_col, expo)], by = id_col, all.x = TRUE)
        exposure_status[[expo]] <- "loaded"
      } else {
        exposure_status[[expo]] <- "table read failed"
      }
    }
  }
  loaded_exposures <- names(exposure_status)[unlist(exposure_status) == "loaded"]
  if (length(loaded_exposures) == 0) {
    cat(toJSON(list(error = "no exposures could be loaded", exposure_status = exposure_status), auto_unbox = TRUE))
    quit(status = 1)
  }

  # Log10 + scale continuous exposures (paper convention)
  for (expo in loaded_exposures) {
    v <- as.numeric(base[[expo]])
    n_unique <- length(unique(v[!is.na(v)]))
    is_cat <- n_unique <= 5 && all(v[!is.na(v)] %% 1 == 0)
    if (!is_cat) {
      pos <- v[!is.na(v) & v > 0]
      eps <- if (length(pos) > 0) min(pos) / 2 else 1e-6
      v_t <- log10(pmax(v, 0) + eps)
      base[[expo]] <- as.numeric(scale(v_t))
    } else {
      base[[expo]] <- as.factor(v)
    }
  }

  # Filter rows where outcome is observed (we only impute predictor missingness)
  dat <- base[!is.na(base[[outcome_name]]), ]
  if (has_survey && wt_col %in% names(dat)) {
    dat <- dat[!is.na(dat[[wt_col]]) & dat[[wt_col]] > 0, ]
  }

  n_outcome_observed <- nrow(dat)
  if (n_outcome_observed < 100) {
    cat(toJSON(list(error = paste0("only ", n_outcome_observed, " participants have outcome observed")), auto_unbox = TRUE))
    quit(status = 1)
  }

  # ─── 3. Pre-filter covariates: keep only those present in data ───
  cov_terms <- covariates
  cov_vars  <- unique(gsub("I\\((\\w+)\\^[0-9]+\\)", "\\1", cov_terms))
  cov_vars  <- intersect(cov_vars, names(dat))
  cov_terms <- cov_terms[gsub("I\\((\\w+)\\^[0-9]+\\)", "\\1", cov_terms) %in% cov_vars]

  # Treat known categorical covariates as factors
  cat_covs <- intersect(c("RIAGENDR", "RIDRETH3", "DMDEDUC2"), names(dat))
  for (cv in cat_covs) dat[[cv]] <- as.factor(dat[[cv]])

  # ─── 4. Imputation ───
  impute_vars <- c(cov_vars, loaded_exposures)
  impute_vars <- intersect(impute_vars, names(dat))
  impute_dat  <- dat[, c(outcome_name, impute_vars), drop = FALSE]

  # Compute missingness summary
  missing_rates <- sapply(impute_dat[, impute_vars, drop = FALSE], function(x) mean(is.na(x)))

  complete_n <- sum(stats::complete.cases(impute_dat))

  imp_used <- imputation
  m_used   <- m

  if (imputation == "complete_case" || complete_n >= 0.95 * n_outcome_observed) {
    # No imputation needed if intersection is nearly full, or user asked for cc
    if (imputation == "mice" && complete_n >= 0.95 * n_outcome_observed) imp_used <- "complete_case_auto"
    imputed_list <- list(impute_dat[stats::complete.cases(impute_dat), , drop = FALSE])
    m_used <- 1
  } else {
    if (imputation == "single_mice") m_used <- 1
    set.seed(1)
    imp_obj <- mice(impute_dat, m = m_used, method = "pmm",
                    maxit = maxit, printFlag = FALSE)
    imputed_list <- complete(imp_obj, action = "all")
  }

  # Re-attach survey design columns + outcome for each imputed set
  design_cols <- intersect(c(wt_col, psu_col, str_col, "cycle"), names(dat))
  imputed_full <- lapply(imputed_list, function(d) {
    d2 <- d
    # Use row position to grab design columns since impute_dat shares row order with dat
    rn <- as.integer(rownames(d2))
    if (length(rn) == 0 || any(is.na(rn))) rn <- seq_len(nrow(d2))
    for (cc in design_cols) d2[[cc]] <- dat[[cc]][rn]
    d2
  })

  use_survey <- has_survey && all(c(psu_col, str_col, wt_col) %in% design_cols)

  baseline_terms <- cov_terms
  expanded_terms <- c(cov_terms, loaded_exposures)
  fml_baseline <- as.formula(paste0(outcome_name, " ~ ", paste(baseline_terms, collapse = " + ")))
  fml_expanded <- as.formula(paste0(outcome_name, " ~ ", paste(expanded_terms, collapse = " + ")))

  # Weighted R² helper
  wR2 <- function(fit, d, y_col, wcol = NULL) {
    fitted_y <- fit$fitted.values
    yv <- d[[y_col]]
    if (length(fitted_y) != length(yv)) {
      # Some rows may have been dropped — align by names if available
      idx <- as.integer(names(fitted_y))
      if (length(idx) == length(fitted_y) && !any(is.na(idx))) yv <- yv[idx]
    }
    res <- yv - fitted_y
    w <- if (!is.null(wcol) && wcol %in% names(d)) d[[wcol]][seq_along(fitted_y)] else rep(1, length(fitted_y))
    if (length(w) != length(res)) w <- rep(1, length(res))
    ss_res <- sum(res^2 * w)
    yw_mean <- weighted.mean(yv, w)
    ss_tot <- sum((yv - yw_mean)^2 * w)
    if (ss_tot <= 0) return(NA_real_)
    1 - ss_res / ss_tot
  }

  if (use_survey) {
    options(survey.lonely.psu = "adjust")
    designs <- svydesign(
      ids = as.formula(paste0("~", psu_col)),
      strata = as.formula(paste0("~", str_col)),
      weights = as.formula(paste0("~", wt_col)),
      nest = TRUE,
      data = mitools::imputationList(imputed_full)
    )
    fits_b <- with(designs, svyglm(fml_baseline))
    fits_e <- with(designs, svyglm(fml_expanded))
    coef_pool_e <- mitools::MIcombine(fits_e)
    coef_pool_b <- mitools::MIcombine(fits_b)
    r2_baseline_each <- mapply(function(f, d) wR2(f, d, outcome_name, wt_col), fits_b, imputed_full)
    r2_expanded_each <- mapply(function(f, d) wR2(f, d, outcome_name, wt_col), fits_e, imputed_full)
  } else {
    fits_b <- lapply(imputed_full, function(d) lm(fml_baseline, data = d))
    fits_e <- lapply(imputed_full, function(d) lm(fml_expanded, data = d))
    coef_pool_e <- mitools::MIcombine(fits_e)
    coef_pool_b <- mitools::MIcombine(fits_b)
    r2_baseline_each <- sapply(fits_b, function(f) summary(f)$r.squared)
    r2_expanded_each <- sapply(fits_e, function(f) summary(f)$r.squared)
  }

  r2_baseline_mean <- mean(r2_baseline_each, na.rm = TRUE)
  r2_expanded_mean <- mean(r2_expanded_each, na.rm = TRUE)
  delta_r2 <- r2_expanded_mean - r2_baseline_mean

  # ─── 5. Extract pooled exposure coefficients ───
  pooled_coefs <- summary(coef_pool_e)
  coef_rows <- data.frame(
    term = rownames(pooled_coefs),
    estimate = pooled_coefs[, "results"],
    std_error = pooled_coefs[, "se"],
    stringsAsFactors = FALSE
  )
  coef_rows$ci_lower <- pooled_coefs[, "(lower"]
  coef_rows$ci_upper <- pooled_coefs[, "upper)"]
  coef_rows$t_stat <- coef_rows$estimate / coef_rows$std_error
  # Approximate two-sided p (large-sample normal)
  coef_rows$p_value <- 2 * pnorm(-abs(coef_rows$t_stat))

  exposure_table <- coef_rows[coef_rows$term %in% loaded_exposures, , drop = FALSE]
  exposure_table <- exposure_table[order(exposure_table$p_value), , drop = FALSE]

  exposure_records <- lapply(seq_len(nrow(exposure_table)), function(i) list(
    exposure = exposure_table$term[i],
    estimate = round(as.numeric(exposure_table$estimate[i]), 6),
    std_error = round(as.numeric(exposure_table$std_error[i]), 6),
    ci_lower = round(as.numeric(exposure_table$ci_lower[i]), 6),
    ci_upper = round(as.numeric(exposure_table$ci_upper[i]), 6),
    p_value = as.numeric(exposure_table$p_value[i])
  ))

  output <- list(
    outcome = outcome_name,
    n = n_outcome_observed,
    n_complete_cases = complete_n,
    cycles_used = cycles_used,
    survey_weighted = use_survey,
    imputation_mode = imp_used,
    m_imputations = m_used,
    maxit = if (imp_used %in% c("mice", "single_mice")) maxit else NULL,
    n_exposures_requested = length(exposures),
    n_exposures_loaded = length(loaded_exposures),
    loaded_exposures = loaded_exposures,
    exposure_load_status = exposure_status,
    covariates_used = cov_terms,
    missing_rates_pct = lapply(missing_rates, function(x) round(100 * x, 2)),
    r2_baseline = list(
      mean = round(r2_baseline_mean, 6),
      sd = round(sd(r2_baseline_each), 6),
      per_imputation = round(as.numeric(r2_baseline_each), 6)
    ),
    r2_expanded = list(
      mean = round(r2_expanded_mean, 6),
      sd = round(sd(r2_expanded_each), 6),
      per_imputation = round(as.numeric(r2_expanded_each), 6)
    ),
    delta_r2 = round(delta_r2, 6),
    exposure_coefficients = exposure_records,
    note = paste0("Exposures are log10-transformed and z-scored. Demo covariates: ",
                  paste(cov_terms, collapse = ", "),
                  ". Coefficients pooled via Rubin's rules (mitools::MIcombine). R² averaged across imputations.")
  )
  cat(toJSON(output, auto_unbox = TRUE, null = "null"))

}, error = function(e) {
  cat(toJSON(list(error = conditionMessage(e)), auto_unbox = TRUE))
  quit(status = 1)
}, finally = {
  try(dbDisconnect(con), silent = TRUE)
})
