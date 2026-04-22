#!/usr/bin/env Rscript
# Cause-specific mortality ExWAS — extends the all-cause mortality ExWAS
# to heart disease, cancer, and diabetes-specific mortality.
#
# Reads the all-cause exposure list from mortality_exwas (already computed),
# then runs Cox PH for each cause × exposure combination.
# Stores results in mortality_exwas_causes table.
#
# Usage:
#   Rscript scripts/compute-mortality-exwas-causes.R

suppressPackageStartupMessages({
  library(survival)
  library(survey)
  library(DBI)
  library(RSQLite)
  library(dplyr)
  library(broom)
})

nhanespewas_path <- Sys.getenv("NHANESPEWAS_PATH",
  unset = file.path(dirname(getwd()), "nhanespewas"))
if (file.exists(file.path(nhanespewas_path, "DESCRIPTION")) && requireNamespace("devtools", quietly = TRUE)) {
  suppressPackageStartupMessages(devtools::load_all(nhanespewas_path, quiet = TRUE))
} else {
  suppressPackageStartupMessages(library(nhanespewas))
}

db_path <- Sys.getenv("EXPOSOMEQL_DB_PATH", unset = "data/nhanes_031725.sqlite")
cat("[mortality-causes] Connecting to", db_path, "\n")
con <- connect_pewas_data(db_path)

# Load mortality data
mort <- dbGetQuery(con, "SELECT SEQN, eligstat, mortstat, ucod_leading, diabetes, hyperten, permth_int FROM mortality")
mort <- mort[mort$eligstat == 1 & !is.na(mort$permth_int) & mort$permth_int > 0, ]
cat("[mortality-causes] Eligible participants:", nrow(mort), "\n")

# Define cause-specific events
# ucod_leading codes: 1=heart, 2=cancer, 3=chronic lower resp, 4=accidents,
# 5=cerebrovascular, 6=alzheimer, 7=diabetes, 8=influenza/pneumonia,
# 9=kidney, 10=all other
causes <- list(
  heart = list(code = 1, label = "Heart disease"),
  cancer = list(code = 2, label = "Malignant neoplasms"),
  diabetes_ucod = list(code = 7, label = "Diabetes (underlying cause)"),
  cerebrovascular = list(code = 5, label = "Cerebrovascular disease"),
  kidney = list(code = 9, label = "Kidney disease")
)

for (cause_name in names(causes)) {
  cause <- causes[[cause_name]]
  mort[[paste0("event_", cause_name)]] <- ifelse(
    mort$mortstat == 1 & !is.na(mort$ucod_leading) & mort$ucod_leading == cause$code, 1, 0)
  n_events <- sum(mort[[paste0("event_", cause_name)]])
  cat("[mortality-causes]", cause$label, ":", n_events, "deaths\n")
}

# Get exposure list from the all-cause results (only valid ones)
out_con <- dbConnect(SQLite(), db_path)
exposure_list <- dbGetQuery(out_con, "SELECT DISTINCT exposure FROM mortality_exwas WHERE error IS NULL AND p_value IS NOT NULL")$exposure
cat("[mortality-causes] Exposures to scan:", length(exposure_list), "\n")

# Create output table
dbExecute(out_con, "DROP TABLE IF EXISTS mortality_exwas_causes")
dbExecute(out_con, "CREATE TABLE mortality_exwas_causes (
  exposure TEXT,
  cause TEXT,
  cause_label TEXT,
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
  error TEXT
)")

yr2s <- c("1999"="A","2001"="B","2003"="C","2005"="D","2007"="E",
          "2009"="F","2011"="G","2013"="H","2015"="I","2017"="J")
yr_from_letter <- c("A"=1999,"B"=2001,"C"=2003,"D"=2005,"E"=2007,
                    "F"=2009,"G"=2011,"H"=2013,"I"=2015,"J"=2017)

n_done <- 0
n_err <- 0
t0 <- Sys.time()
total_combos <- length(exposure_list) * length(causes)

for (expo in exposure_list) {
  # Load and pool exposure data once per exposure
  tab_info <- tryCatch(get_table_names_for_varname(con, expo), error = function(e) NULL)
  if (is.null(tab_info)) next
  cycles <- sort(unique(yr2s[as.character(tab_info$Begin.Year)]))
  cycles <- cycles[!is.na(cycles)]
  if (length(cycles) == 0) next

  pooled_base <- NULL
  for (s in cycles) {
    tab_obj <- tryCatch(get_tables(expo, expo, s, con), error = function(e) NULL)
    if (is.null(tab_obj) || is.null(tab_obj$merged_tab) || nrow(tab_obj$merged_tab) == 0) next
    tab_obj <- figure_out_weight(tab_obj)
    dat <- tab_obj$merged_tab
    dat$series <- s
    if (is.null(pooled_base)) {
      pooled_base <- dat
    } else {
      common_cols <- intersect(names(pooled_base), names(dat))
      pooled_base <- rbind(pooled_base[, common_cols, drop = FALSE], dat[, common_cols, drop = FALSE])
    }
  }

  if (is.null(pooled_base) || nrow(pooled_base) == 0) next

  # Merge with full mortality data (all event columns)
  mort_cols <- c("SEQN", "permth_int", paste0("event_", names(causes)))
  pooled_base <- merge(pooled_base, mort[, mort_cols], by = "SEQN")

  n_cyc <- length(unique(pooled_base$series))
  if (n_cyc > 1) pooled_base$wt <- pooled_base$wt / n_cyc

  # Prepare exposure
  expo_vals <- pooled_base[[expo]]
  if (!is.numeric(expo_vals)) next
  pooled_base <- pooled_base[!is.na(expo_vals) & expo_vals > 0, ]
  if (nrow(pooled_base) < 50) next
  pooled_base$expo <- scale(log10(pooled_base[[expo]]))[,1]

  # Factor covariates
  pooled_base$RIAGENDR <- as.factor(pooled_base$RIAGENDR)
  if ("RIDRETH1" %in% names(pooled_base)) pooled_base$RIDRETH1 <- as.factor(pooled_base$RIDRETH1)
  if ("DMDEDUC2" %in% names(pooled_base)) pooled_base$DMDEDUC2 <- as.factor(pooled_base$DMDEDUC2)
  if (n_cyc > 1) pooled_base$survey_cycle <- as.factor(pooled_base$series)

  cov_vars <- c("RIDAGEYR", "RIAGENDR")
  if ("RIDRETH1" %in% names(pooled_base)) cov_vars <- c(cov_vars, "RIDRETH1")
  if ("INDFMPIR" %in% names(pooled_base)) cov_vars <- c(cov_vars, "INDFMPIR")
  if ("DMDEDUC2" %in% names(pooled_base)) cov_vars <- c(cov_vars, "DMDEDUC2")
  if (n_cyc > 1) cov_vars <- c(cov_vars, "survey_cycle")

  req_cols <- c("expo", "permth_int", "wt", "SDMVPSU", "SDMVSTRA", cov_vars)
  req_cols <- intersect(req_cols, names(pooled_base))
  pooled_clean <- pooled_base[complete.cases(pooled_base[, req_cols, drop = FALSE]), ]
  pooled_clean <- pooled_clean[pooled_clean$wt > 0, ]

  if (nrow(pooled_clean) < 50) next

  median_fu <- median(pooled_clean$permth_int, na.rm = TRUE) / 12

  # Run each cause
  for (cause_name in names(causes)) {
    event_col <- paste0("event_", cause_name)
    n_events <- sum(pooled_clean[[event_col]] == 1, na.rm = TRUE)

    if (n_events < 5) {
      dbExecute(out_con, "INSERT INTO mortality_exwas_causes VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        params = list(expo, cause_name, causes[[cause_name]]$label, NA, NA, NA, NA, NA,
                      nrow(pooled_clean), n_events, n_cyc,
                      paste(unique(pooled_clean$series), collapse=","), median_fu, "too few events"))
      next
    }

    tryCatch({
      pooled_clean$current_event <- pooled_clean[[event_col]]
      options(survey.lonely.psu = "adjust")
      dsn <- svydesign(ids = ~SDMVPSU, strata = ~SDMVSTRA, weights = ~wt, nest = TRUE, data = pooled_clean)

      fml_terms <- c("expo", cov_vars)
      fml <- as.formula(paste0("Surv(permth_int, current_event) ~ ", paste(fml_terms, collapse = " + ")))
      fit <- svycoxph(fml, design = dsn)

      tidied <- tidy(fit, conf.int = TRUE, exponentiate = TRUE)
      tidied_raw <- tidy(fit, conf.int = TRUE, exponentiate = FALSE)
      expo_row <- tidied[tidied$term == "expo", ]
      expo_raw <- tidied_raw[tidied_raw$term == "expo", ]

      if (nrow(expo_row) > 0) {
        dbExecute(out_con, "INSERT INTO mortality_exwas_causes VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
          params = list(expo, cause_name, causes[[cause_name]]$label,
            round(as.numeric(expo_raw$estimate[1]), 6),
            round(as.numeric(expo_row$estimate[1]), 6),
            round(as.numeric(expo_row$conf.low[1]), 6),
            round(as.numeric(expo_row$conf.high[1]), 6),
            as.numeric(expo_row$p.value[1]),
            nrow(pooled_clean), n_events, n_cyc,
            paste(unique(pooled_clean$series), collapse=","), median_fu, NA_character_))
      }

      n_done <- n_done + 1
    }, error = function(e) {
      n_err <<- n_err + 1
      tryCatch(dbExecute(out_con, "INSERT INTO mortality_exwas_causes VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        params = list(expo, cause_name, causes[[cause_name]]$label,
          NA, NA, NA, NA, NA, nrow(pooled_clean), n_events, n_cyc,
          paste(unique(pooled_clean$series), collapse=","), median_fu, conditionMessage(e))),
        error = function(e2) NULL)
    })
  }

  if ((n_done + n_err) %% 100 == 0) {
    elapsed <- as.numeric(difftime(Sys.time(), t0, units = "mins"))
    cat(sprintf("[mortality-causes] %d/%d combos done (%.0f err), %.1f min\n",
                n_done + n_err, total_combos, n_err, elapsed))
  }
}

dbDisconnect(out_con)
disconnect_pewas_data(con)

elapsed <- as.numeric(difftime(Sys.time(), t0, units = "mins"))
cat(sprintf("\n[mortality-causes] Complete: %d results, %d errors, %.1f minutes\n",
            n_done, n_err, elapsed))

# Summary
sum_con <- dbConnect(SQLite(), db_path)
for (cause_name in names(causes)) {
  n <- dbGetQuery(sum_con, sprintf("SELECT COUNT(*) as n FROM mortality_exwas_causes WHERE cause='%s' AND p_value IS NOT NULL AND error IS NULL", cause_name))$n
  n_sig <- dbGetQuery(sum_con, sprintf("SELECT COUNT(*) as n FROM mortality_exwas_causes WHERE cause='%s' AND p_value < 0.05 AND error IS NULL", cause_name))$n
  cat(sprintf("  %s: %d tested, %d nominal p<0.05\n", causes[[cause_name]]$label, n, n_sig))
}
dbDisconnect(sum_con)
