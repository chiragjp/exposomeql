#!/usr/bin/env Rscript
# Cohort-level descriptive statistics for HHEAR targeted data
# Computes mean, SD, geometric mean, median, N, 95% CI
# LOD handling: impute <LOD as LOD/2 when >=75% complete

suppressPackageStartupMessages({
  library(jsonlite)
  library(dplyr)
})

params <- if (exists("POOL_PARAMS", envir = globalenv())) get("POOL_PARAMS", envir = globalenv()) else fromJSON(file("stdin"))

targeted_csv <- params$targeted_csv
epi_csv <- params$epi_csv
analyte <- params$analyte
subgroup <- params$subgroup  # optional R expression on epi data columns
creatinine_adjust <- params$creatinine_adjust  # optional TRUE/FALSE

tryCatch({
  # Read targeted data (long format)
  targeted <- read.csv(targeted_csv, stringsAsFactors = FALSE)

  # Normalize column names (some cohorts use different cases)
  names(targeted) <- tolower(names(targeted))

  # Detect PID column in targeted data (may be pid, child_pid, subject_id)
  tgt_pid_candidates <- intersect(c("pid", "child_pid", "subject_id"), names(targeted))
  if (length(tgt_pid_candidates) == 0) tgt_pid_candidates <- grep("pid", names(targeted), value = TRUE)
  tgt_pid_col <- if (length(tgt_pid_candidates) > 0) tgt_pid_candidates[1] else "pid"

  # Filter to the requested analyte
  dat <- targeted %>%
    filter(tolower(analyte_code) == tolower(analyte))

  if (nrow(dat) == 0) {
    cat(toJSON(list(error = paste0("Analyte '", analyte, "' not found in this cohort.")), auto_unbox = TRUE))
    quit(status = 1)
  }

  # LOD handling: impute values below LOD as LOD/2
  # Comment_code == 1 typically means below LOD
  if ("comment_code" %in% names(dat) && "lod" %in% names(dat)) {
    below_lod <- !is.na(dat$comment_code) & dat$comment_code %in% c(37, 199)
    pct_below_lod <- sum(below_lod, na.rm = TRUE) / nrow(dat) * 100

    # Only impute if >=75% complete (i.e., <=25% below LOD)
    if (pct_below_lod <= 25) {
      lod_val <- median(dat$lod[dat$lod > 0], na.rm = TRUE)
      if (!is.na(lod_val) && lod_val > 0) {
        dat$concentration[below_lod] <- lod_val / 2
      }
    }
  } else {
    pct_below_lod <- NA
  }

  # Creatinine adjustment: divide by creatinine (CRE) concentration
  cre_adjusted <- FALSE
  if (!is.null(creatinine_adjust) && creatinine_adjust) {
    cre_dat <- targeted %>% filter(tolower(analyte_code) == "cre")
    if (nrow(cre_dat) > 0) {
      cre_dat$pid_lower <- tolower(as.character(cre_dat[[tgt_pid_col]]))
      dat$pid_lower <- tolower(as.character(dat[[tgt_pid_col]]))
      merged_cre <- merge(dat, cre_dat[, c("pid_lower", "concentration")],
                          by = "pid_lower", suffixes = c("", ".cre"))
      cre_val <- as.numeric(merged_cre$concentration.cre)
      conc_raw <- as.numeric(merged_cre$concentration)
      valid <- !is.na(conc_raw) & !is.na(cre_val) & cre_val > 0
      dat <- merged_cre[valid, ]
      dat$concentration <- conc_raw[valid] / cre_val[valid] * 100
      cre_adjusted <- TRUE
    }
  }

  conc <- as.numeric(dat$concentration)
  conc <- conc[!is.na(conc)]

  if (length(conc) == 0) {
    cat(toJSON(list(error = "No valid concentration values after filtering."), auto_unbox = TRUE))
    quit(status = 1)
  }

  # Apply subgroup filter if provided
  if (!is.null(subgroup) && nzchar(subgroup)) {
    epi <- read.csv(epi_csv, stringsAsFactors = FALSE)
    names(epi) <- tolower(names(epi))

    # Join targeted with epi on pid (epi may use child_pid, subject_id, etc.)
    dat$pid_lower <- tolower(as.character(dat[[tgt_pid_col]]))
    epi_pid_col <- intersect(c("pid", "child_pid", "subject_id"), names(epi))
    if (length(epi_pid_col) == 0) epi_pid_col <- grep("pid", names(epi), value = TRUE)
    if (length(epi_pid_col) == 0) stop("No PID column found in epi data")
    epi$pid_lower <- tolower(as.character(epi[[epi_pid_col[1]]]))

    merged <- merge(dat, epi, by = "pid_lower", suffixes = c("", ".epi"))

    # Apply subgroup filter
    merged <- tryCatch(
      merged %>% filter(eval(parse(text = subgroup))),
      error = function(e) {
        stop(paste0("Invalid subgroup filter: ", conditionMessage(e)))
      }
    )

    conc <- as.numeric(merged$concentration)
    conc <- conc[!is.na(conc)]
  }

  n <- length(conc)

  # Compute statistics
  mn <- mean(conc)
  sdev <- sd(conc)
  med <- median(conc)

  # 95% CI via t-test
  ci <- if (n >= 2) t.test(conc)$conf.int else c(NA, NA)

  # Geometric mean (only for positive values)
  pos_conc <- conc[conc > 0]
  gmean <- if (length(pos_conc) > 0) exp(mean(log(pos_conc))) else NA

  # Percentiles
  pctiles <- quantile(conc, probs = c(0.05, 0.25, 0.50, 0.75, 0.95), na.rm = TRUE)

  # Units from data
  units_val <- unique(dat$units)
  units_val <- units_val[!is.na(units_val)][1]

  output <- list(
    analyte = analyte,
    n = n,
    mean = round(mn, 6),
    sd = round(sdev, 6),
    median = round(med, 6),
    geometric_mean = if (!is.na(gmean)) round(gmean, 6) else NULL,
    ci_lower = round(ci[1], 6),
    ci_upper = round(ci[2], 6),
    percentiles = list(
      p5 = round(pctiles[1], 6),
      p25 = round(pctiles[2], 6),
      p50 = round(pctiles[3], 6),
      p75 = round(pctiles[4], 6),
      p95 = round(pctiles[5], 6)
    ),
    units = if (cre_adjusted) paste0(units_val, "/g CRE") else units_val,
    creatinine_adjusted = cre_adjusted,
    pct_below_lod = if (!is.na(pct_below_lod)) round(pct_below_lod, 2) else NULL,
    lod_method = if (!is.na(pct_below_lod) && pct_below_lod > 0) "LOD/2 substitution (when >=75% complete)" else NULL
  )

  cat(toJSON(output, auto_unbox = TRUE, null = "null"))

}, error = function(e) {
  cat(toJSON(list(error = conditionMessage(e)), auto_unbox = TRUE))
  quit(status = 1)
})
