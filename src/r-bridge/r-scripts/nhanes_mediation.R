#!/usr/bin/env Rscript
# Survey-weighted causal mediation analysis for ExposomeQL
# exposure → mediator → outcome
# Uses mediation::mediate() with survey-weighted models

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

if (!requireNamespace("mediation", quietly = TRUE)) {
  cat(toJSON(list(error = "R package 'mediation' is required but not installed. Install with: install.packages('mediation')"), auto_unbox = TRUE))
  quit(status = 1)
}
suppressPackageStartupMessages(library(mediation))

params <- if (exists("POOL_PARAMS", envir = globalenv())) get("POOL_PARAMS", envir = globalenv()) else fromJSON(file("stdin"))
db_path <- Sys.getenv("EXPOSOMEQL_DB_PATH")

exposure <- params$exposure
mediator_var <- params$mediator
outcome_var <- params$outcome
covariates <- params$covariates
cycles <- params$cycles

con <- connect_pewas_data(db_path)
# on.exit removed for pool compatibility; cleanup handled in tryCatch finally

if (is.null(cycles)) {
  tab_info <- get_table_names_for_varname(con, exposure)
  yr2s <- c("1999"="A","2001"="B","2003"="C","2005"="D","2007"="E","2009"="F","2011"="G","2013"="H","2015"="I","2017"="J")
  cycles <- tail(sort(unique(yr2s[as.character(tab_info$Begin.Year)])), 1)
}

tryCatch({
  all_vars <- unique(c(exposure, mediator_var, outcome_var, covariates))

  # Load data
  all_data <- NULL
  for (s in cycles) {
    tab_obj <- tryCatch(
      get_tables(exposure, outcome_var, s, con),
      error = function(e) NULL
    )
    if (is.null(tab_obj)) next
    tab_obj <- figure_out_weight(tab_obj)
    if (!is.null(tab_obj$merged_tab) && nrow(tab_obj$merged_tab) > 0) {
      dat <- tab_obj$merged_tab
      if (is.null(all_data)) {
        all_data <- dat
      } else {
        common_cols <- intersect(names(all_data), names(dat))
        all_data <- rbind(all_data[, common_cols], dat[, common_cols])
      }
    }
  }

  if (is.null(all_data) || nrow(all_data) == 0) {
    cat(toJSON(list(error = "No data found for specified variables and cycles"), auto_unbox = TRUE))
    quit(status = 1)
  }

  # Load additional variable tables if needed
  missing_vars <- setdiff(all_vars, names(all_data))
  if (length(missing_vars) > 0 && "SEQN" %in% names(all_data)) {
    for (mv in missing_vars) {
      tab_info <- tryCatch(get_table_names_for_varname(con, mv), error = function(e) NULL)
      if (!is.null(tab_info) && nrow(tab_info) > 0) {
        # Stack the variable across all cycles first, then merge once. Merging
        # per-cycle into the pooled frame renames the column to <var>.x/.y on the
        # 2nd cycle (base::merge dup-name suffixes), dropping it entirely.
        add_df <- NULL
        for (s in cycles) {
          yr2s <- c("A"=1999,"B"=2001,"C"=2003,"D"=2005,"E"=2007,"F"=2009,"G"=2011,"H"=2013,"I"=2015,"J"=2017)
          yr <- yr2s[s]
          tab_row <- tab_info[!is.na(tab_info$Begin.Year) & tab_info$Begin.Year == yr, ]
          if (nrow(tab_row) == 0) next
          tab_name <- tab_row$Data.File.Name[1]
          extra <- tryCatch(DBI::dbReadTable(con, tab_name), error = function(e) NULL)
          if (is.null(extra) || !(mv %in% names(extra)) || !("SEQN" %in% names(extra))) next
          piece <- extra[, c("SEQN", mv), drop = FALSE]
          add_df <- if (is.null(add_df)) piece else rbind(add_df, piece)
        }
        if (!is.null(add_df)) {
          add_df <- add_df[!duplicated(add_df$SEQN), , drop = FALSE]
          all_data <- merge(all_data, add_df, by = "SEQN", all.x = TRUE)
        }
      }
    }
    missing_vars <- setdiff(all_vars, names(all_data))
  }

  if (length(missing_vars) > 0) {
    cat(toJSON(list(error = paste0("Variables not found: ", paste(missing_vars, collapse = ", "))), auto_unbox = TRUE))
    quit(status = 1)
  }

  # Filter
  dat <- all_data %>% filter(!is.na(wt), wt > 0)
  for (v in all_vars) {
    dat <- dat %>% filter(!is.na(.data[[v]]))
  }

  n_cycles <- length(cycles)
  if (n_cycles > 1) {
    if (n_cycles == 2 && all(c("A", "B") %in% cycles) && "WTMEC4YR" %in% names(dat)) {
      dat$wt <- dat$WTMEC4YR
    } else {
      dat$wt <- dat$wt / n_cycles
    }
  }

  if (nrow(dat) < 50) {
    cat(toJSON(list(error = paste0("Insufficient sample size for mediation (n=", nrow(dat), "). Need at least 50.")), auto_unbox = TRUE))
    quit(status = 1)
  }

  # Covariate formula part
  cov_terms <- ""
  if (!is.null(covariates) && length(covariates) > 0) {
    cov_terms <- paste0(" + ", paste(covariates, collapse = " + "))
  }

  # Survey design
  options(survey.lonely.psu = "adjust")
  dsn <- svydesign(
    ids = ~SDMVPSU,
    strata = ~SDMVSTRA,
    weights = ~wt,
    nest = TRUE,
    data = dat
  )

  # Step 1: Mediator model — mediator ~ exposure + covariates
  med_fml <- as.formula(paste0(mediator_var, " ~ ", exposure, cov_terms))
  med_fit <- svyglm(med_fml, design = dsn)

  # Step 2: Outcome model — outcome ~ exposure + mediator + covariates
  out_fml <- as.formula(paste0(outcome_var, " ~ ", exposure, " + ", mediator_var, cov_terms))
  out_fit <- svyglm(out_fml, design = dsn)

  # Step 3: Mediation analysis
  # Note: mediation::mediate works with svyglm objects
  med_result <- mediate(
    med_fit, out_fit,
    treat = exposure,
    mediator = mediator_var,
    sims = 1000
  )

  smry <- summary(med_result)

  # Also extract direct model coefficients for transparency
  med_coefs <- tidy(med_fit, conf.int = TRUE)
  out_coefs <- tidy(out_fit, conf.int = TRUE)

  # Extract exposure coefficient from mediator model (a path)
  a_path <- med_coefs[med_coefs$term == exposure, ]
  # Extract mediator coefficient from outcome model (b path)
  b_path <- out_coefs[out_coefs$term == mediator_var, ]
  # Extract exposure coefficient from outcome model (c' path / direct effect)
  c_prime <- out_coefs[out_coefs$term == exposure, ]

  output <- list(
    exposure = exposure,
    mediator = mediator_var,
    outcome = outcome_var,
    n = nrow(dat),
    cycles_used = cycles,
    mediation_results = list(
      acme = list(
        estimate = round(smry$d0, 6),
        ci_lower = round(smry$d0.ci[1], 6),
        ci_upper = round(smry$d0.ci[2], 6),
        p_value = smry$d0.p
      ),
      ade = list(
        estimate = round(smry$z0, 6),
        ci_lower = round(smry$z0.ci[1], 6),
        ci_upper = round(smry$z0.ci[2], 6),
        p_value = smry$z0.p
      ),
      total_effect = list(
        estimate = round(smry$tau.coef, 6),
        ci_lower = round(smry$tau.ci[1], 6),
        ci_upper = round(smry$tau.ci[2], 6),
        p_value = smry$tau.p
      ),
      proportion_mediated = list(
        estimate = round(smry$n0, 6),
        ci_lower = round(smry$n0.ci[1], 6),
        ci_upper = round(smry$n0.ci[2], 6),
        p_value = smry$n0.p
      )
    ),
    path_coefficients = list(
      a_path = if (nrow(a_path) > 0) list(
        description = paste0(exposure, " → ", mediator_var),
        estimate = round(as.numeric(a_path$estimate[1]), 6),
        p_value = as.numeric(a_path$p.value[1])
      ) else NULL,
      b_path = if (nrow(b_path) > 0) list(
        description = paste0(mediator_var, " → ", outcome_var, " (adjusted for ", exposure, ")"),
        estimate = round(as.numeric(b_path$estimate[1]), 6),
        p_value = as.numeric(b_path$p.value[1])
      ) else NULL,
      c_prime = if (nrow(c_prime) > 0) list(
        description = paste0(exposure, " → ", outcome_var, " (direct, adjusted for ", mediator_var, ")"),
        estimate = round(as.numeric(c_prime$estimate[1]), 6),
        p_value = as.numeric(c_prime$p.value[1])
      ) else NULL
    ),
    mediator_model = deparse(med_fml),
    outcome_model = deparse(out_fml),
    note = "ACME = Average Causal Mediation Effect (indirect). ADE = Average Direct Effect. Bootstrap uses 1000 simulations. Survey weights are used in the underlying models but mediation bootstrap may not fully respect complex survey design."
  )

  cat(toJSON(output, auto_unbox = TRUE, null = "null"))

}, error = function(e) {
  cat(toJSON(list(error = conditionMessage(e)), auto_unbox = TRUE))
  quit(status = 1)
}, finally = {
  try(disconnect_pewas_data(con), silent = TRUE)
})
