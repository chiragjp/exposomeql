#!/usr/bin/env Rscript
# Cumulative Exposure Score for HHEAR cohort data
# For each participant, compute percentile rank of each chemical,
# then calculate average Z-score across all chemicals.
# Based on the methodology from HHEAR exposome papers.

suppressPackageStartupMessages({
  library(jsonlite)
  library(dplyr)
})

params <- fromJSON(file("stdin"))

targeted_csv <- params$targeted_csv
epi_csv <- params$epi_csv
analytes <- params$analytes          # character vector of analyte codes to include
creatinine_adjust <- params$creatinine_adjust  # optional, TRUE/FALSE
method <- params$method              # "percentile_rank" (default) or "z_score"

if (is.null(method)) method <- "percentile_rank"

tryCatch({
  targeted <- read.csv(targeted_csv, stringsAsFactors = FALSE)
  names(targeted) <- tolower(names(targeted))

  # Get creatinine data for adjustment if requested
  cre_data <- NULL
  if (!is.null(creatinine_adjust) && creatinine_adjust) {
    cre_data <- targeted %>%
      filter(tolower(analyte_code) == "cre") %>%
      mutate(pid_lower = tolower(as.character(pid)),
             cre_val = as.numeric(concentration)) %>%
      select(pid_lower, cre_val) %>%
      filter(!is.na(cre_val), cre_val > 0)
  }

  # Filter to requested analytes (exclude CRE and SG)
  if (is.null(analytes) || length(analytes) == 0) {
    analytes <- unique(targeted$analyte_code)
    analytes <- analytes[!analytes %in% c("CRE", "SG", "cre", "sg")]
  }

  # Process each analyte: LOD imputation, optional CRE adjustment, then score
  scored_data <- list()
  analyte_stats <- list()

  for (a in analytes) {
    chem <- targeted %>%
      filter(tolower(analyte_code) == tolower(a))
    if (nrow(chem) < 10) next

    # LOD imputation
    if ("comment_code" %in% names(chem) && "lod" %in% names(chem)) {
      below_lod <- !is.na(chem$comment_code) & chem$comment_code %in% c(37, 199)
      pct_below <- sum(below_lod, na.rm = TRUE) / nrow(chem) * 100
      if (pct_below > 25) next  # skip if >25% below LOD
      lod_val <- median(chem$lod[chem$lod > 0], na.rm = TRUE)
      if (!is.na(lod_val) && lod_val > 0) {
        chem$concentration[below_lod] <- lod_val / 2
      }
    }

    chem$conc <- as.numeric(chem$concentration)
    chem$pid_lower <- tolower(as.character(chem$pid))
    chem <- chem[!is.na(chem$conc), ]

    # Creatinine adjustment
    if (!is.null(cre_data) && nrow(cre_data) > 0) {
      chem <- merge(chem, cre_data, by = "pid_lower", all.x = FALSE)
      chem$conc <- chem$conc / chem$cre_val * 100
    }

    if (nrow(chem) < 10) next

    # Compute scores
    if (method == "z_score") {
      mn <- mean(chem$conc, na.rm = TRUE)
      sdev <- sd(chem$conc, na.rm = TRUE)
      if (sdev > 0) {
        chem$score <- (chem$conc - mn) / sdev
      } else {
        next
      }
    } else {
      # Percentile rank (0-1 scale)
      chem$score <- rank(chem$conc, ties.method = "average") / nrow(chem)
    }

    scored_data[[a]] <- chem[, c("pid_lower", "score")]
    names(scored_data[[a]])[2] <- paste0("score_", a)

    analyte_stats[[length(analyte_stats) + 1]] <- list(
      analyte = a,
      n = nrow(chem),
      mean_conc = round(mean(chem$conc, na.rm = TRUE), 4),
      sd_conc = round(sd(chem$conc, na.rm = TRUE), 4),
      mean_score = round(mean(chem$score, na.rm = TRUE), 4)
    )
  }

  if (length(scored_data) == 0) {
    cat(toJSON(list(error = "No analytes had sufficient data for scoring."), auto_unbox = TRUE))
    quit(status = 1)
  }

  # Merge all scores by PID
  combined <- scored_data[[1]]
  if (length(scored_data) > 1) {
    for (i in 2:length(scored_data)) {
      combined <- merge(combined, scored_data[[i]], by = "pid_lower", all = FALSE)
    }
  }

  # Compute cumulative score = mean of all individual scores per participant
  score_cols <- grep("^score_", names(combined), value = TRUE)
  combined$cumulative_score <- rowMeans(combined[, score_cols, drop = FALSE], na.rm = TRUE)
  combined$n_chemicals <- rowSums(!is.na(combined[, score_cols, drop = FALSE]))

  # Summary statistics of the cumulative score
  cs <- combined$cumulative_score
  summary_stats <- list(
    n_participants = nrow(combined),
    n_chemicals_included = length(scored_data),
    chemicals_included = names(scored_data),
    score_method = method,
    creatinine_adjusted = if (!is.null(creatinine_adjust)) creatinine_adjust else FALSE,
    cumulative_score_stats = list(
      mean = round(mean(cs, na.rm = TRUE), 4),
      sd = round(sd(cs, na.rm = TRUE), 4),
      median = round(median(cs, na.rm = TRUE), 4),
      min = round(min(cs, na.rm = TRUE), 4),
      max = round(max(cs, na.rm = TRUE), 4),
      p25 = round(quantile(cs, 0.25, na.rm = TRUE), 4),
      p75 = round(quantile(cs, 0.75, na.rm = TRUE), 4)
    ),
    per_analyte_stats = analyte_stats,
    # Top 10 highest and lowest cumulative scores
    top_10_highest = head(combined[order(-combined$cumulative_score), c("pid_lower", "cumulative_score", "n_chemicals")], 10),
    top_10_lowest = head(combined[order(combined$cumulative_score), c("pid_lower", "cumulative_score", "n_chemicals")], 10)
  )

  # If epi data available, check association of cumulative score with demographics
  if (!is.null(epi_csv) && nzchar(epi_csv)) {
    tryCatch({
      epi <- read.csv(epi_csv, stringsAsFactors = FALSE)
      names(epi) <- tolower(names(epi))
      epi$pid_lower <- tolower(as.character(epi$pid))

      merged <- merge(combined[, c("pid_lower", "cumulative_score")], epi, by = "pid_lower")

      if ("age" %in% names(merged) && sum(!is.na(as.numeric(merged$age))) > 10) {
        merged$age_num <- as.numeric(merged$age)
        cor_age <- cor.test(merged$cumulative_score, merged$age_num, use = "complete.obs")
        summary_stats$age_correlation <- list(
          r = round(cor_age$estimate, 4),
          p_value = cor_age$p.value,
          n = sum(!is.na(merged$age_num) & !is.na(merged$cumulative_score))
        )
      }

      sex_col <- intersect(c("sex", "gender"), names(merged))
      if (length(sex_col) > 0) {
        merged$sex_fac <- as.factor(merged[[sex_col[1]]])
        if (nlevels(merged$sex_fac) == 2) {
          tt <- t.test(cumulative_score ~ sex_fac, data = merged)
          summary_stats$sex_difference <- list(
            groups = levels(merged$sex_fac),
            mean_by_group = round(tapply(merged$cumulative_score, merged$sex_fac, mean, na.rm = TRUE), 4),
            t_statistic = round(tt$statistic, 4),
            p_value = tt$p.value
          )
        }
      }
    }, error = function(e) {
      # Skip demographic analysis if it fails
    })
  }

  cat(toJSON(summary_stats, auto_unbox = TRUE, null = "null"))

}, error = function(e) {
  cat(toJSON(list(error = conditionMessage(e)), auto_unbox = TRUE))
  quit(status = 1)
})
