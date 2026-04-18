#!/usr/bin/env Rscript
# Quantile ExWAS for HHEAR cohort data
# Iterates over all analytes in a cohort, regressing each on age + sex + year
# Uses quantile regression at median (τ=0.5) by default
# Applies BH-FDR correction at 10%

suppressPackageStartupMessages({
  library(jsonlite)
  library(quantreg)
  library(dplyr)
})

params <- if (exists("POOL_PARAMS", envir = globalenv())) get("POOL_PARAMS", envir = globalenv()) else fromJSON(file("stdin"))

targeted_csv <- params$targeted_csv
epi_csv <- params$epi_csv
analytes <- params$analytes      # character vector of analyte codes to test
tau_val <- params$tau             # quantile to test, default 0.5
fdr_threshold <- params$fdr_threshold  # default 0.10
creatinine_adjust <- params$creatinine_adjust  # optional TRUE/FALSE
age_column <- params$age_column      # cohort-specific age column name (lowercased)
sex_column <- params$sex_column      # cohort-specific sex column name (lowercased)
age_transform <- params$age_transform  # optional R expression for unit conversion

if (is.null(tau_val)) tau_val <- 0.5
if (is.null(fdr_threshold)) fdr_threshold <- 0.10

tryCatch({
  if (is.null(epi_csv) || !nzchar(epi_csv)) {
    cat(toJSON(list(error = "This cohort has no demographic (epi) data — cannot run ExWAS."), auto_unbox = TRUE))
    quit(status = 1)
  }

  targeted <- read.csv(targeted_csv, stringsAsFactors = FALSE)
  epi <- read.csv(epi_csv, stringsAsFactors = FALSE)

  names(targeted) <- tolower(names(targeted))
  names(epi) <- tolower(names(epi))

  # Detect PID columns
  tgt_pid_candidates <- intersect(c("pid", "child_pid", "subject_id"), names(targeted))
  if (length(tgt_pid_candidates) == 0) tgt_pid_candidates <- grep("pid", names(targeted), value = TRUE)
  tgt_pid_col <- if (length(tgt_pid_candidates) > 0) tgt_pid_candidates[1] else "pid"

  epi_pid_candidates <- intersect(c("pid", "child_pid", "subject_id"), names(epi))
  if (length(epi_pid_candidates) == 0) epi_pid_candidates <- grep("pid", names(epi), value = TRUE)
  epi_pid_col <- if (length(epi_pid_candidates) > 0) epi_pid_candidates[1] else "pid"

  epi$pid_join <- tolower(as.character(epi[[epi_pid_col]]))

  # Load creatinine data for adjustment if requested
  cre_data <- NULL
  if (!is.null(creatinine_adjust) && creatinine_adjust) {
    cre_data <- targeted %>%
      filter(tolower(analyte_code) == "cre") %>%
      mutate(pid_join = tolower(as.character(.data[[tgt_pid_col]])),
             cre_val = as.numeric(concentration)) %>%
      select(pid_join, cre_val) %>%
      filter(!is.na(cre_val), cre_val > 0)
  }

  # Detect sex column in epi — use provided mapping or search common names
  has_sex <- FALSE
  if (!is.null(sex_column) && sex_column %in% names(epi)) {
    sex_col <- sex_column
    has_sex <- TRUE
  } else {
    sex_candidates <- intersect(c("sex", "gender", "gender_form03"), names(epi))
    if (length(sex_candidates) > 0) {
      sex_col <- sex_candidates[1]
      has_sex <- TRUE
    }
  }

  # Detect year column in targeted
  year_col <- intersect(c("sample_collection_year"), names(targeted))
  has_year <- length(year_col) > 0

  if (is.null(analytes) || length(analytes) == 0) {
    analytes <- unique(targeted$analyte_code)
    # Exclude dilution markers
    analytes <- analytes[!analytes %in% c("CRE", "SG")]
  }

  message(paste0("[cohort_exwas] Testing ", length(analytes), " analytes at tau=", tau_val))

  results <- list()
  errors <- character()

  for (a in analytes) {
    tryCatch({
      chem <- targeted %>% filter(tolower(analyte_code) == tolower(a))
      if (nrow(chem) < 20) next

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

      chem$pid_join <- tolower(as.character(chem[[tgt_pid_col]]))

      # Creatinine adjustment
      if (!is.null(cre_data) && nrow(cre_data) > 0) {
        chem <- merge(chem, cre_data, by = "pid_join", all.x = FALSE)
        chem$concentration <- as.numeric(chem$concentration) / chem$cre_val * 100
      }

      merged <- merge(chem, epi, by = "pid_join", suffixes = c("", ".epi"))

      merged$conc <- as.numeric(merged$concentration)

      # Resolve age: use transform, provided column, or default
      if (!is.null(age_transform) && nzchar(age_transform)) {
        merged$age_val <- eval(parse(text = age_transform), envir = merged)
      } else if (!is.null(age_column) && age_column %in% names(merged)) {
        merged$age_val <- as.numeric(merged[[age_column]])
      } else if ("age" %in% names(merged)) {
        merged$age_val <- as.numeric(merged$age)
      }

      # Build formula
      formula_terms <- "age_val"
      if (has_sex) {
        merged$sex_val <- as.factor(merged[[sex_col]])
        # Drop sex if only 1 level after filtering
        if (nlevels(merged$sex_val) >= 2) {
          formula_terms <- paste(formula_terms, "+ sex_val")
        }
      }
      if (has_year) {
        merged$year_val <- as.numeric(merged[[year_col[1]]])
        formula_terms <- paste(formula_terms, "+ year_val")
      }

      model_cols <- c("conc", "age_val")
      if (has_sex) model_cols <- c(model_cols, "sex_val")
      if (has_year) model_cols <- c(model_cols, "year_val")
      merged <- merged[complete.cases(merged[, model_cols, drop = FALSE]), ]

      if (nrow(merged) < 20) next

      fml <- as.formula(paste("conc ~", formula_terms))
      fit <- rq(fml, data = merged, tau = tau_val)
      smry <- summary(fit, se = "nid")

      coefs <- as.data.frame(smry$coefficients)
      coefs$term <- rownames(coefs)
      names(coefs) <- c("estimate", "std_error", "t_value", "p_value", "term")

      # Extract age coefficient as primary effect
      age_row <- coefs[coefs$term == "age_val", ]
      if (nrow(age_row) > 0) {
        results[[length(results) + 1]] <- list(
          analyte = a,
          term = "age_val",
          estimate = round(age_row$estimate[1], 6),
          std_error = round(age_row$std_error[1], 6),
          p_value = age_row$p_value[1],
          n = nrow(merged),
          tau = tau_val
        )
      }
    }, error = function(e) {
      errors <<- c(errors, paste0(a, ": ", conditionMessage(e)))
    })
  }

  # Sort by p-value and apply FDR
  if (length(results) > 0) {
    pvals <- sapply(results, function(x) x$p_value)
    results <- results[order(pvals)]

    n_tests <- length(results)
    sorted_pvals <- sapply(results, function(x) x$p_value)
    bonferroni <- pmin(sorted_pvals * n_tests, 1)
    bh_fdr <- p.adjust(sorted_pvals, method = "BH")

    for (i in seq_along(results)) {
      results[[i]]$p_bonferroni <- bonferroni[i]
      results[[i]]$p_fdr_bh <- bh_fdr[i]
    }
  }

  output <- list(
    n_analytes_tested = length(analytes),
    n_results = length(results),
    n_errors = length(errors),
    tau = tau_val,
    fdr_threshold = fdr_threshold,
    n_significant_fdr = sum(sapply(results, function(x) x$p_fdr_bh < fdr_threshold)),
    results = results,
    errors = if (length(errors) > 0) errors else NULL,
    note = "Quantile regression at specified tau. P-values corrected: p_bonferroni and p_fdr_bh (BH). FDR threshold = 10%."
  )

  cat(toJSON(output, auto_unbox = TRUE, null = "null"))

}, error = function(e) {
  cat(toJSON(list(error = conditionMessage(e)), auto_unbox = TRUE))
  quit(status = 1)
})
