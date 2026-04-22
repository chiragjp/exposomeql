#!/usr/bin/env Rscript
# Multi-tau quantile regression for NHANES (survey-weighted).
# Fits outcome ~ exposure + covariates at multiple quantiles using quantreg::rq
# with NHANES survey weights. Shows how the exposure effect varies across the
# outcome distribution — e.g., "does lead affect uric acid more at the 95th
# percentile than at the 25th?"

suppressPackageStartupMessages({
  library(jsonlite)
  library(DBI)
  library(RSQLite)
  library(dplyr)
  library(quantreg)
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

outcome_var  <- params$outcome
exposure_var <- params$exposure
covariates   <- params$covariates   # character vector, or NULL
taus         <- params$taus         # numeric vector, or NULL
cycles       <- params$cycles       # series letters, or NULL
log_exposure <- params$log_exposure # TRUE/FALSE, default TRUE

if (is.null(taus)) taus <- c(0.05, 0.10, 0.25, 0.50, 0.75, 0.90, 0.95)
if (is.null(log_exposure)) log_exposure <- TRUE

con <- connect_pewas_data(db_path)

if (is.null(cycles)) {
  tab_info <- get_table_names_for_varname(con, exposure_var)
  yr2s <- c("1999"="A","2001"="B","2003"="C","2005"="D","2007"="E","2009"="F",
            "2011"="G","2013"="H","2015"="I","2017"="J")
  cycles <- tail(sort(unique(yr2s[as.character(tab_info$Begin.Year)])), 1)
}

yr_from_letter <- c("A"=1999,"B"=2001,"C"=2003,"D"=2005,"E"=2007,"F"=2009,
                    "G"=2011,"H"=2013,"I"=2015,"J"=2017)

tryCatch({
  # Pool data across cycles
  pooled <- NULL
  for (s in cycles) {
    tab_obj <- tryCatch(get_tables(exposure_var, outcome_var, s, con), error = function(e) NULL)
    if (is.null(tab_obj) || is.null(tab_obj$merged_tab) || nrow(tab_obj$merged_tab) == 0) next
    tab_obj <- figure_out_weight(tab_obj)
    dat <- tab_obj$merged_tab
    dat$series <- s

    # Merge additional covariates if needed
    if (!is.null(covariates) && length(covariates) > 0 && "SEQN" %in% names(dat)) {
      missing_here <- setdiff(covariates, names(dat))
      for (mv in missing_here) {
        tinfo <- tryCatch(get_table_names_for_varname(con, mv), error = function(e) NULL)
        if (is.null(tinfo) || nrow(tinfo) == 0) next
        tinfo <- tinfo[!grepl("^P_", tinfo$Data.File.Name), ]
        if (nrow(tinfo) == 0) next
        yr <- yr_from_letter[s]
        trow <- tinfo[tinfo$Begin.Year == yr, ]
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
    cat(toJSON(list(error = "No data found for specified variables and cycles"), auto_unbox = TRUE))
    quit(status = 1)
  }

  # Weight adjustment for multi-cycle pooling
  n_cycles <- length(unique(pooled$series))
  if (n_cycles > 1) {
    if (n_cycles == 2 && all(c("A","B") %in% unique(pooled$series)) && "WTMEC4YR" %in% names(pooled)) {
      pooled$wt <- pooled$WTMEC4YR
    } else {
      pooled$wt <- pooled$wt / n_cycles
    }
  }

  # Prepare exposure
  expo_raw <- pooled[[exposure_var]]
  if (log_exposure) {
    pooled <- pooled[!is.na(expo_raw) & expo_raw > 0, ]
    pooled$expo <- log10(pooled[[exposure_var]])
  } else {
    pooled$expo <- pooled[[exposure_var]]
  }

  # Build covariate terms
  cov_terms <- c()
  cov_present <- c()
  if (!is.null(covariates)) {
    cov_present <- intersect(covariates, names(pooled))
    for (v in cov_present) {
      vals <- pooled[[v]]
      if (is.character(vals) || is.factor(vals) || length(unique(vals[!is.na(vals)])) <= 10) {
        pooled[[v]] <- as.factor(pooled[[v]])
      }
      cov_terms <- c(cov_terms, v)
    }
  }

  # Drop incomplete cases
  required <- c(outcome_var, "expo", "wt", cov_present)
  required <- intersect(required, names(pooled))
  pooled <- pooled[complete.cases(pooled[, required, drop = FALSE]), ]
  pooled <- pooled[pooled$wt > 0, ]

  if (nrow(pooled) < 30) {
    cat(toJSON(list(error = paste0("Insufficient sample size (n=", nrow(pooled), ").")), auto_unbox = TRUE))
    quit(status = 1)
  }

  # Build formula
  all_terms <- c("expo", cov_terms)
  fml <- as.formula(paste0("`", outcome_var, "` ~ ", paste(all_terms, collapse = " + ")))

  # Fit at each tau
  results <- list()
  for (tau in taus) {
    fit <- rq(fml, data = pooled, tau = tau, weights = pooled$wt)
    smry <- summary(fit, se = "nid")

    coefs <- as.data.frame(smry$coefficients)
    coefs$term <- rownames(coefs)
    names(coefs) <- c("estimate", "std_error", "t_value", "p_value", "term")

    # Extract exposure coefficient
    expo_row <- coefs[coefs$term == "expo", ]

    # Pseudo R² (1 - weighted check loss ratio)
    null_fit <- rq(as.formula(paste0("`", outcome_var, "` ~ 1")), data = pooled, tau = tau, weights = pooled$wt)
    rho <- function(u, t) u * (t - (u < 0))
    pseudo_r2 <- 1 - sum(rho(fit$residuals, tau)) / sum(rho(null_fit$residuals, tau))

    results[[length(results) + 1]] <- list(
      tau = tau,
      exposure_effect = if (nrow(expo_row) > 0) list(
        estimate = round(expo_row$estimate[1], 6),
        std_error = round(expo_row$std_error[1], 6),
        t_value = round(expo_row$t_value[1], 4),
        p_value = expo_row$p_value[1]
      ) else NULL,
      all_coefficients = lapply(seq_len(nrow(coefs)), function(i) {
        list(
          term = coefs$term[i],
          estimate = round(coefs$estimate[i], 6),
          std_error = round(coefs$std_error[i], 6),
          p_value = coefs$p_value[i]
        )
      }),
      pseudo_r_squared = round(pseudo_r2, 6)
    )
  }

  # Summary: how the exposure effect varies across quantiles
  expo_effects <- sapply(results, function(r) {
    if (!is.null(r$exposure_effect)) r$exposure_effect$estimate else NA
  })
  expo_pvals <- sapply(results, function(r) {
    if (!is.null(r$exposure_effect)) r$exposure_effect$p_value else NA
  })

  output <- list(
    outcome = outcome_var,
    exposure = exposure_var,
    log_exposure = log_exposure,
    covariates = cov_present,
    formula = deparse(fml),
    n = nrow(pooled),
    cycles_used = unique(pooled$series),
    n_cycles = n_cycles,
    taus = taus,
    quantile_results = results,
    exposure_effect_summary = list(
      taus = taus,
      estimates = round(expo_effects, 6),
      p_values = expo_pvals,
      range = round(diff(range(expo_effects, na.rm = TRUE)), 6),
      interpretation = if (diff(range(expo_effects, na.rm = TRUE)) > 0.05)
        "Effect varies substantially across quantiles — the exposure affects different parts of the outcome distribution differently."
      else
        "Effect is relatively uniform across quantiles — the exposure shifts the entire outcome distribution similarly."
    ),
    note = paste0(
      "Quantile regression via quantreg::rq() with NHANES survey weights. ",
      "Exposure is ", if (log_exposure) "log10-transformed (not z-scored). " else "untransformed. ",
      "Coefficients represent the change in the tau-th quantile of the outcome per unit change in ",
      if (log_exposure) "log10(exposure)." else "exposure."
    )
  )

  cat(toJSON(output, auto_unbox = TRUE, null = "null"))

}, error = function(e) {
  cat(toJSON(list(error = conditionMessage(e)), auto_unbox = TRUE))
  quit(status = 1)
}, finally = {
  try(disconnect_pewas_data(con), silent = TRUE)
})
