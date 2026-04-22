#!/usr/bin/env Rscript
# ExWAS on all-cause mortality — pre-compute Cox PH hazard ratios for all
# available NHANES exposure variables linked to NDI mortality.
#
# Methodology: Patel, Rehkopf, Leppert et al. IJE 2013
# - Cox proportional hazards regression
# - Survey-weighted (svycoxph)
# - Fully adjusted: age + sex + race/ethnicity + income + education + survey cycle
# - Exposure: log10-transformed, z-scored (continuous) or as-is (categorical)
# - Pool across ALL available cycles per exposure
# - Output: SQLite table `mortality_exwas` with one row per exposure
#
# Usage:
#   Rscript scripts/compute-mortality-exwas.R
#   Rscript scripts/compute-mortality-exwas.R --resume   # skip already-computed exposures

suppressPackageStartupMessages({
  library(jsonlite)
  library(survival)
  library(survey)
  library(DBI)
  library(RSQLite)
  library(dplyr)
  library(broom)
})

args <- commandArgs(trailingOnly = TRUE)
RESUME <- "--resume" %in% args

nhanespewas_path <- Sys.getenv("NHANESPEWAS_PATH",
  unset = file.path(dirname(getwd()), "nhanespewas"))
if (file.exists(file.path(nhanespewas_path, "DESCRIPTION")) && requireNamespace("devtools", quietly = TRUE)) {
  suppressPackageStartupMessages(devtools::load_all(nhanespewas_path, quiet = TRUE))
} else {
  suppressPackageStartupMessages(library(nhanespewas))
}

db_path <- Sys.getenv("EXPOSOMEQL_DB_PATH",
  unset = "data/nhanes_031725.sqlite")

cat("[mortality-exwas] Connecting to", db_path, "\n")
con <- connect_pewas_data(db_path)

# Load mortality data
mort <- dbGetQuery(con, "SELECT SEQN, eligstat, mortstat, ucod_leading, permth_int FROM mortality")
mort <- mort[mort$eligstat == 1 & !is.na(mort$permth_int) & mort$permth_int > 0, ]
mort$event <- ifelse(mort$mortstat == 1, 1, 0)
mort$event[is.na(mort$event)] <- 0
cat("[mortality-exwas] Mortality data:", nrow(mort), "eligible participants,",
    sum(mort$event), "deaths\n")

# Get list of exposure variables to scan from the PE stats database
pe_db_path <- Sys.getenv("EXPOSOMEQL_PE_DB_PATH",
  unset = file.path(dirname(db_path), "pe_summary_stats_01_2025.sqlite"))
cat("[mortality-exwas] PE stats database:", pe_db_path, "\n")
pe_con <- dbConnect(SQLite(), pe_db_path)
exposure_vars <- dbGetQuery(pe_con,
  "SELECT DISTINCT evarname FROM adjusted_meta_uwls WHERE expo_name = 'expo' AND model_number = 6")
exposure_vars <- sort(unique(exposure_vars$evarname))
dbDisconnect(pe_con)
cat("[mortality-exwas] Exposures to scan:", length(exposure_vars), "\n")

# Setup output table
out_con <- dbConnect(SQLite(), db_path)

if (!RESUME) {
  dbExecute(out_con, "DROP TABLE IF EXISTS mortality_exwas")
  dbExecute(out_con, "CREATE TABLE mortality_exwas (
    exposure TEXT,
    log_hr REAL,
    hr REAL,
    hr_lower REAL,
    hr_upper REAL,
    p_value REAL,
    n INTEGER,
    n_events INTEGER,
    n_cycles INTEGER,
    cycles TEXT,
    median_followup_years REAL,
    model TEXT,
    error TEXT
  )")
  already_done <- character(0)
} else {
  already_done <- dbGetQuery(out_con, "SELECT DISTINCT exposure FROM mortality_exwas")$exposure
  cat("[mortality-exwas] Resuming; already computed:", length(already_done), "\n")
}

yr2s <- c("1999"="A","2001"="B","2003"="C","2005"="D","2007"="E",
          "2009"="F","2011"="G","2013"="H","2015"="I","2017"="J")
yr_from_letter <- c("A"=1999,"B"=2001,"C"=2003,"D"=2005,"E"=2007,
                    "F"=2009,"G"=2011,"H"=2013,"I"=2015,"J"=2017)

model_desc <- "age + sex + race/ethnicity + income + education + survey_cycle"

n_done <- 0
n_err <- 0
t0 <- Sys.time()

for (expo in exposure_vars) {
  if (expo %in% already_done) next

  tryCatch({
    # Find available cycles for this exposure
    tab_info <- get_table_names_for_varname(con, expo)
    cycles <- sort(unique(yr2s[as.character(tab_info$Begin.Year)]))
    cycles <- cycles[!is.na(cycles)]
    if (length(cycles) == 0) {
      dbExecute(out_con, "INSERT INTO mortality_exwas VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        params = list(expo, NA, NA, NA, NA, NA, NA, NA, 0, "", NA, model_desc, "no cycles"))
      next
    }

    # Pool across cycles
    pooled <- NULL
    for (s in cycles) {
      tab_obj <- tryCatch(get_tables(expo, expo, s, con), error = function(e) NULL)
      if (is.null(tab_obj) || is.null(tab_obj$merged_tab) || nrow(tab_obj$merged_tab) == 0) next
      tab_obj <- figure_out_weight(tab_obj)
      dat <- tab_obj$merged_tab
      dat$series <- s
      if (is.null(pooled)) {
        pooled <- dat
      } else {
        common_cols <- intersect(names(pooled), names(dat))
        pooled <- rbind(pooled[, common_cols, drop = FALSE], dat[, common_cols, drop = FALSE])
      }
    }

    if (is.null(pooled) || nrow(pooled) == 0) {
      dbExecute(out_con, "INSERT INTO mortality_exwas VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        params = list(expo, NA, NA, NA, NA, NA, NA, NA, length(cycles), paste(cycles, collapse=","), NA, model_desc, "no data"))
      next
    }

    # Merge with mortality
    pooled <- merge(pooled, mort[, c("SEQN", "event", "permth_int")], by = "SEQN")

    # Weight adjustment
    n_cyc <- length(unique(pooled$series))
    if (n_cyc > 1) pooled$wt <- pooled$wt / n_cyc

    # Prepare exposure (log10 + z-score for continuous)
    expo_vals <- pooled[[expo]]
    if (!is.numeric(expo_vals)) {
      dbExecute(out_con, "INSERT INTO mortality_exwas VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        params = list(expo, NA, NA, NA, NA, NA, nrow(pooled), sum(pooled$event), n_cyc,
                      paste(unique(pooled$series), collapse=","), NA, model_desc, "non-numeric"))
      next
    }
    pooled <- pooled[!is.na(expo_vals) & expo_vals > 0, ]
    if (nrow(pooled) < 50) {
      dbExecute(out_con, "INSERT INTO mortality_exwas VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        params = list(expo, NA, NA, NA, NA, NA, nrow(pooled), sum(pooled$event), n_cyc,
                      paste(unique(pooled$series), collapse=","), NA, model_desc, "too few obs"))
      next
    }
    pooled$expo <- scale(log10(pooled[[expo]]))[,1]

    # Factor covariates
    pooled$RIAGENDR <- as.factor(pooled$RIAGENDR)
    pooled$RIDRETH1 <- if ("RIDRETH1" %in% names(pooled)) as.factor(pooled$RIDRETH1) else NULL
    if (n_cyc > 1) pooled$survey_cycle <- as.factor(pooled$series)

    # Complete cases
    cov_vars <- c("RIDAGEYR", "RIAGENDR")
    if ("RIDRETH1" %in% names(pooled)) cov_vars <- c(cov_vars, "RIDRETH1")
    if ("INDFMPIR" %in% names(pooled)) cov_vars <- c(cov_vars, "INDFMPIR")
    if ("DMDEDUC2" %in% names(pooled)) {
      pooled$DMDEDUC2 <- as.factor(pooled$DMDEDUC2)
      cov_vars <- c(cov_vars, "DMDEDUC2")
    }
    if (n_cyc > 1) cov_vars <- c(cov_vars, "survey_cycle")

    req_cols <- c("expo", "event", "permth_int", "wt", "SDMVPSU", "SDMVSTRA", cov_vars)
    req_cols <- intersect(req_cols, names(pooled))
    pooled <- pooled[complete.cases(pooled[, req_cols, drop = FALSE]), ]
    pooled <- pooled[pooled$wt > 0, ]
    n_events <- sum(pooled$event == 1)

    if (nrow(pooled) < 50 || n_events < 5) {
      dbExecute(out_con, "INSERT INTO mortality_exwas VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        params = list(expo, NA, NA, NA, NA, NA, nrow(pooled), n_events, n_cyc,
                      paste(unique(pooled$series), collapse=","), NA, model_desc, "too few events"))
      next
    }

    # Survey design + Cox PH
    options(survey.lonely.psu = "adjust")
    dsn <- svydesign(ids = ~SDMVPSU, strata = ~SDMVSTRA, weights = ~wt, nest = TRUE, data = pooled)

    fml_terms <- c("expo", cov_vars)
    fml <- as.formula(paste0("Surv(permth_int, event) ~ ", paste(fml_terms, collapse = " + ")))
    fit <- svycoxph(fml, design = dsn)

    tidied <- tidy(fit, conf.int = TRUE, exponentiate = TRUE)
    tidied_raw <- tidy(fit, conf.int = TRUE, exponentiate = FALSE)
    expo_row <- tidied[tidied$term == "expo", ]
    expo_raw <- tidied_raw[tidied_raw$term == "expo", ]

    if (nrow(expo_row) == 0) {
      dbExecute(out_con, "INSERT INTO mortality_exwas VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        params = list(expo, NA, NA, NA, NA, NA, nrow(pooled), n_events, n_cyc,
                      paste(unique(pooled$series), collapse=","), NA, model_desc, "no expo coef"))
      next
    }

    median_fu <- median(pooled$permth_int, na.rm = TRUE) / 12

    dbExecute(out_con, "INSERT INTO mortality_exwas VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
      params = list(
        expo,
        round(as.numeric(expo_raw$estimate[1]), 6),
        round(as.numeric(expo_row$estimate[1]), 6),
        round(as.numeric(expo_row$conf.low[1]), 6),
        round(as.numeric(expo_row$conf.high[1]), 6),
        as.numeric(expo_row$p.value[1]),
        nrow(pooled),
        n_events,
        n_cyc,
        paste(unique(pooled$series), collapse=","),
        round(median_fu, 1),
        model_desc,
        NA_character_
      ))

    n_done <- n_done + 1
    if (n_done %% 25 == 0) {
      elapsed <- as.numeric(difftime(Sys.time(), t0, units = "mins"))
      rate <- n_done / elapsed
      remaining <- (length(exposure_vars) - length(already_done) - n_done) / rate
      cat(sprintf("[mortality-exwas] %d/%d done (%.0f err), %.1f min elapsed, ~%.0f min remaining\n",
                  n_done + length(already_done), length(exposure_vars), n_err, elapsed, remaining))
    }

  }, error = function(e) {
    n_err <<- n_err + 1
    tryCatch(
      dbExecute(out_con, "INSERT INTO mortality_exwas VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
        params = list(expo, NA, NA, NA, NA, NA, NA, NA, NA, "", NA, model_desc, conditionMessage(e))),
      error = function(e2) NULL
    )
  })
}

dbDisconnect(out_con)
disconnect_pewas_data(con)

elapsed <- as.numeric(difftime(Sys.time(), t0, units = "mins"))
cat(sprintf("\n[mortality-exwas] Complete: %d exposures, %d errors, %.1f minutes\n",
            n_done, n_err, elapsed))

# Summary
sum_con <- dbConnect(SQLite(), db_path)
n_total <- dbGetQuery(sum_con, "SELECT COUNT(*) as n FROM mortality_exwas")$n
n_sig <- dbGetQuery(sum_con, "SELECT COUNT(*) as n FROM mortality_exwas WHERE p_value < 0.05")$n
n_bonf <- dbGetQuery(sum_con, "SELECT COUNT(*) as n FROM mortality_exwas WHERE p_value < 0.05 / COUNT(*) OVER()")$n
cat(sprintf("[mortality-exwas] %d total, %d nominal (p<0.05), %d Bonferroni\n", n_total, n_sig, n_bonf))

# Top 10 by p-value
top <- dbGetQuery(sum_con, "SELECT exposure, hr, hr_lower, hr_upper, p_value, n, n_events
  FROM mortality_exwas WHERE p_value IS NOT NULL ORDER BY p_value LIMIT 10")
cat("\nTop 10 exposures by p-value:\n")
print(top)
dbDisconnect(sum_con)
