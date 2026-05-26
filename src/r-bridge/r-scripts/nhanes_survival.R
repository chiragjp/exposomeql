#!/usr/bin/env Rscript
# Cox proportional hazards regression for NHANES-linked mortality.
# Implements the Patel, Rehkopf, Leppert et al. (IJE 2013) ExWAS-mortality
# methodology: exposure → all-cause or cause-specific mortality via Cox PH
# with survey weights, adjusting for age, sex, race/ethnicity, SES, education.
#
# Requires the `mortality` table in the NHANES SQLite database with columns:
#   SEQN, eligstat, mortstat, ucod_leading, permth_int, permth_exm

suppressPackageStartupMessages({
  library(jsonlite)
  library(survival)
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

params <- if (exists("POOL_PARAMS", envir = globalenv())) get("POOL_PARAMS", envir = globalenv()) else fromJSON(file("stdin"))
db_path <- Sys.getenv("EXPOSOMEQL_DB_PATH")

exposure     <- params$exposure          # NHANES variable name
cause        <- params$cause             # "all", "heart", "cancer", "diabetes", etc., or NULL
covariates   <- if (!is.null(params$covariates)) as.character(unlist(params$covariates)) else NULL
cycles       <- if (!is.null(params$cycles)) as.character(unlist(params$cycles)) else NULL
log_exposure <- params$log_exposure      # TRUE/FALSE, default TRUE
time_variable <- params$time_variable    # "permth_int" (default) or "permth_exm"
subgroup     <- params$subgroup          # R expression string for filtering, or NULL

if (is.null(log_exposure)) log_exposure <- TRUE
if (is.null(time_variable)) time_variable <- "permth_int"
if (is.null(cause)) cause <- "all"

con <- connect_pewas_data(db_path)

yr_from_letter <- c("A"=1999,"B"=2001,"C"=2003,"D"=2005,"E"=2007,"F"=2009,
                    "G"=2011,"H"=2013,"I"=2015,"J"=2017)

# For survival analysis, default to ALL available cycles (not just 3 most recent)
# to maximize sample size, deaths, and follow-up time.
if (is.null(cycles)) {
  tab_info <- get_table_names_for_varname(con, exposure)
  yr2s <- c("1999"="A","2001"="B","2003"="C","2005"="D","2007"="E","2009"="F",
            "2011"="G","2013"="H","2015"="I","2017"="J")
  cycles <- sort(unique(yr2s[as.character(tab_info$Begin.Year)]))
  # Exclude P_ (pandemic) tables — already filtered out below
}

tryCatch({
  # Load mortality data
  mort <- dbGetQuery(con, "SELECT SEQN, eligstat, mortstat, ucod_leading, diabetes, hyperten, permth_int, permth_exm FROM mortality")
  # Keep only eligible participants (eligstat == 1) with valid follow-up
  mort <- mort[mort$eligstat == 1 & !is.na(mort$permth_int) & mort$permth_int > 0, ]

  # Define event based on cause
  if (cause == "all") {
    mort$event <- ifelse(mort$mortstat == 1, 1, 0)
  } else if (cause == "heart") {
    mort$event <- ifelse(mort$mortstat == 1 & mort$ucod_leading %in% c(1), 1, 0)
  } else if (cause == "cancer") {
    mort$event <- ifelse(mort$mortstat == 1 & mort$ucod_leading %in% c(2), 1, 0)
  } else if (cause == "diabetes") {
    mort$event <- ifelse(mort$mortstat == 1 & mort$diabetes == 1, 1, 0)
  } else {
    mort$event <- ifelse(mort$mortstat == 1, 1, 0)
  }
  mort$event[is.na(mort$event)] <- 0

  # Pool exposure data across cycles
  pooled <- NULL
  for (s in cycles) {
    tab_obj <- tryCatch(get_tables(exposure, exposure, s, con), error = function(e) NULL)
    if (is.null(tab_obj) || is.null(tab_obj$merged_tab) || nrow(tab_obj$merged_tab) == 0) next
    tab_obj <- figure_out_weight(tab_obj)
    dat <- tab_obj$merged_tab
    dat$series <- s

    # Merge covariates if needed
    if (!is.null(covariates) && length(covariates) > 0 && "SEQN" %in% names(dat)) {
      missing_here <- setdiff(covariates, names(dat))
      for (mv in missing_here) {
        tinfo <- tryCatch(get_table_names_for_varname(con, mv), error = function(e) NULL)
        if (is.null(tinfo) || nrow(tinfo) == 0) next
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
    cat(toJSON(list(error = "No exposure data found for specified cycles"), auto_unbox = TRUE))
    quit(status = 1)
  }

  # Merge with mortality
  pooled <- merge(pooled, mort[, c("SEQN", "event", "permth_int", "permth_exm")], by = "SEQN")

  # Weight adjustment
  n_cycles <- length(unique(pooled$series))
  if (n_cycles > 1) {
    pooled$wt <- pooled$wt / n_cycles
  }

  # Prepare exposure
  expo_raw <- pooled[[exposure]]
  if (log_exposure && is.numeric(expo_raw)) {
    pooled <- pooled[!is.na(expo_raw) & expo_raw > 0, ]
    pooled$expo <- scale(log10(pooled[[exposure]]))[,1]
    expo_transform <- "log10, z-scored"
  } else {
    pooled$expo <- pooled[[exposure]]
    expo_transform <- "untransformed"
  }

  # Factor categorical covariates
  cov_present <- c()
  if (!is.null(covariates)) {
    cov_present <- intersect(covariates, names(pooled))
    for (v in cov_present) {
      vals <- pooled[[v]]
      if (is.character(vals) || is.factor(vals) || length(unique(vals[!is.na(vals)])) <= 10) {
        pooled[[v]] <- as.factor(pooled[[v]])
      }
    }
  }

  # Add survey cycle as a factor covariate to adjust for secular trends
  # (exposure levels, healthcare access, and mortality risk change over time)
  if (n_cycles > 1) {
    pooled$survey_cycle <- as.factor(pooled$series)
    cov_present <- c(cov_present, "survey_cycle")
  }

  # Complete cases
  time_col <- time_variable
  required <- c("expo", "event", time_col, "wt", "SDMVPSU", "SDMVSTRA", cov_present)
  required <- intersect(required, names(pooled))
  pooled <- pooled[complete.cases(pooled[, required, drop = FALSE]), ]
  pooled <- pooled[pooled$wt > 0, ]

  # Apply subgroup filter if specified (e.g. "RIAGENDR==1" for a males-only Cox
  # model) — fits a SEPARATE survival model within this subset. RIAGENDR and
  # other demographics are present via the DEMO join in get_tables(). NA rows
  # under the filter expression are dropped.
  if (!is.null(subgroup) && nzchar(subgroup)) {
    keep <- with(pooled, eval(parse(text = subgroup)))
    keep[is.na(keep)] <- FALSE
    pooled <- pooled[keep, , drop = FALSE]
  }

  n_events <- sum(pooled$event == 1)
  n_total <- nrow(pooled)

  if (n_total < 50 || n_events < 10) {
    cat(toJSON(list(error = paste0("Insufficient data: n=", n_total, ", events=", n_events, ". Need >=50 participants and >=10 events.")), auto_unbox = TRUE))
    quit(status = 1)
  }

  # Survey design
  options(survey.lonely.psu = "adjust")
  dsn <- svydesign(ids = ~SDMVPSU, strata = ~SDMVSTRA, weights = ~wt,
                   nest = TRUE, data = pooled)

  # Build formula
  surv_obj <- paste0("Surv(", time_col, ", event)")
  all_terms <- c("expo", cov_present)
  fml <- as.formula(paste(surv_obj, "~", paste(all_terms, collapse = " + ")))

  # Fit Cox model
  fit <- svycoxph(fml, design = dsn)
  tidied <- tidy(fit, conf.int = TRUE, exponentiate = TRUE)

  # Extract exposure HR
  expo_row <- tidied[tidied$term == "expo", ]

  # Also get non-exponentiated coefficient
  tidied_raw <- tidy(fit, conf.int = TRUE, exponentiate = FALSE)
  expo_raw_row <- tidied_raw[tidied_raw$term == "expo", ]

  # Median follow-up
  median_followup_months <- median(pooled[[time_col]], na.rm = TRUE)

  output <- list(
    exposure = exposure,
    cause = cause,
    subgroup = subgroup,
    exposure_transform = expo_transform,
    n = n_total,
    n_events = n_events,
    event_rate = round(n_events / n_total, 4),
    median_followup_months = round(median_followup_months, 1),
    median_followup_years = round(median_followup_months / 12, 1),
    cycles_used = unique(pooled$series),
    n_cycles = n_cycles,
    covariates = cov_present,
    hazard_ratio = if (nrow(expo_row) > 0) list(
      HR = round(as.numeric(expo_row$estimate[1]), 4),
      CI_lower = round(as.numeric(expo_row$conf.low[1]), 4),
      CI_upper = round(as.numeric(expo_row$conf.high[1]), 4),
      p_value = as.numeric(expo_row$p.value[1]),
      log_HR = round(as.numeric(expo_raw_row$estimate[1]), 6),
      interpretation = paste0(
        "A 1-SD increase in ", expo_transform, " ", exposure,
        " is associated with a HR of ", round(as.numeric(expo_row$estimate[1]), 2),
        " (95% CI: ", round(as.numeric(expo_row$conf.low[1]), 2), "-",
        round(as.numeric(expo_row$conf.high[1]), 2), ") for ", cause, " mortality."
      )
    ) else NULL,
    all_coefficients = lapply(seq_len(nrow(tidied)), function(i) {
      list(
        term = tidied$term[i],
        HR = round(as.numeric(tidied$estimate[i]), 4),
        CI_lower = round(as.numeric(tidied$conf.low[i]), 4),
        CI_upper = round(as.numeric(tidied$conf.high[i]), 4),
        p_value = as.numeric(tidied$p.value[i])
      )
    }),
    note = "Cox proportional hazards regression with NHANES survey weights, linked to the National Death Index. HR is per 1-SD change in log10(exposure) for continuous variables. Follow-up through December 2019. Methodology follows Patel, Rehkopf, Leppert et al. IJE 2013."
  )

  cat(toJSON(output, auto_unbox = TRUE, null = "null"))

}, error = function(e) {
  cat(toJSON(list(error = conditionMessage(e)), auto_unbox = TRUE))
  quit(status = 1)
}, finally = {
  try(disconnect_pewas_data(con), silent = TRUE)
})
