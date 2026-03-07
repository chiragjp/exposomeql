#!/usr/bin/env Rscript
# Cross-cohort comparison: compute descriptive stats for the same analyte
# across multiple HHEAR cohorts. Returns a table of means, medians, CIs.

suppressPackageStartupMessages({
  library(jsonlite)
  library(dplyr)
})

params <- fromJSON(file("stdin"))

# params$cohorts is a data.frame with columns: id, targeted_csv, epi_csv
# (fromJSON converts array of objects to data.frame by default)
cohorts <- params$cohorts
analyte <- params$analyte
creatinine_adjust <- params$creatinine_adjust  # TRUE/FALSE

tryCatch({
  results <- list()

  # Iterate over rows (fromJSON makes a data.frame, not a list)
  for (i in seq_len(nrow(cohorts))) {
    coh <- as.list(cohorts[i, , drop = FALSE])
    tryCatch({
      targeted <- read.csv(coh$targeted_csv, stringsAsFactors = FALSE)
      names(targeted) <- tolower(names(targeted))

      dat <- targeted %>%
        filter(tolower(analyte_code) == tolower(analyte))

      if (nrow(dat) == 0) next

      # LOD handling
      if ("comment_code" %in% names(dat) && "lod" %in% names(dat)) {
        below_lod <- !is.na(dat$comment_code) & dat$comment_code %in% c(37, 199)
        pct_below_lod <- sum(below_lod, na.rm = TRUE) / nrow(dat) * 100
        if (pct_below_lod <= 25) {
          lod_val <- median(dat$lod[dat$lod > 0], na.rm = TRUE)
          if (!is.na(lod_val) && lod_val > 0) {
            dat$concentration[below_lod] <- lod_val / 2
          }
        }
      } else {
        pct_below_lod <- NA
      }

      conc <- as.numeric(dat$concentration)
      conc <- conc[!is.na(conc)]

      # Creatinine adjustment if requested
      if (!is.null(creatinine_adjust) && creatinine_adjust) {
        cre_dat <- targeted %>%
          filter(tolower(analyte_code) == "cre")
        if (nrow(cre_dat) > 0) {
          cre_dat$pid_lower <- tolower(as.character(cre_dat$pid))
          dat$pid_lower <- tolower(as.character(dat$pid))
          merged <- merge(dat, cre_dat[, c("pid_lower", "concentration")],
                          by = "pid_lower", suffixes = c("", ".cre"))
          cre_val <- as.numeric(merged$concentration.cre)
          conc_raw <- as.numeric(merged$concentration)
          # Creatinine-adjusted = concentration / creatinine * 100
          valid <- !is.na(conc_raw) & !is.na(cre_val) & cre_val > 0
          conc <- conc_raw[valid] / cre_val[valid] * 100
        }
      }

      if (length(conc) == 0) next

      n <- length(conc)
      mn <- mean(conc)
      sdev <- sd(conc)
      med <- median(conc)
      ci <- if (n >= 2) t.test(conc)$conf.int else c(NA, NA)
      pos_conc <- conc[conc > 0]
      gmean <- if (length(pos_conc) > 0) exp(mean(log(pos_conc))) else NA
      pctiles <- quantile(conc, probs = c(0.25, 0.75), na.rm = TRUE)
      units_val <- unique(dat$units)
      units_val <- units_val[!is.na(units_val)][1]

      results[[length(results) + 1]] <- list(
        cohort_id = coh$id,
        n = n,
        mean = round(mn, 4),
        sd = round(sdev, 4),
        median = round(med, 4),
        geometric_mean = if (!is.na(gmean)) round(gmean, 4) else NULL,
        ci_lower = round(ci[1], 4),
        ci_upper = round(ci[2], 4),
        iqr_lower = round(pctiles[1], 4),
        iqr_upper = round(pctiles[2], 4),
        pct_below_lod = if (!is.na(pct_below_lod)) round(pct_below_lod, 1) else NULL,
        units = if (is.null(creatinine_adjust) || !creatinine_adjust) units_val else paste0(units_val, "/g CRE")
      )
    }, error = function(e) {
      # Skip failed cohorts
    })
  }

  output <- list(
    analyte = analyte,
    creatinine_adjusted = if (!is.null(creatinine_adjust)) creatinine_adjust else FALSE,
    n_cohorts = length(results),
    cohort_results = results
  )

  cat(toJSON(output, auto_unbox = TRUE, null = "null"))

}, error = function(e) {
  cat(toJSON(list(error = conditionMessage(e)), auto_unbox = TRUE))
  quit(status = 1)
})
