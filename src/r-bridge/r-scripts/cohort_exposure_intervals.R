#!/usr/bin/env Rscript
# Exposure Intervals via Conditional Quantile Regression (HHEAR)
# Implements the core method from Lloyd, Tierney, Isaac et al.
# For children: Qy(τ|X) = β0(τ) + β1(τ)·Age + β2(τ)·Sex
# For adults:   Qy(τ|X) = β0(τ) + β1(τ)·Age
# τ ∈ {0.05, 0.25, 0.50, 0.75, 0.95}

suppressPackageStartupMessages({
  library(jsonlite)
  library(quantreg)
  library(dplyr)
})

params <- fromJSON(file("stdin"))

targeted_csv <- params$targeted_csv
epi_csv <- params$epi_csv
analyte <- params$analyte
population <- params$population  # "child" or "adult"
quantiles <- params$quantiles    # optional, defaults to c(0.05, 0.25, 0.5, 0.75, 0.95)
creatinine_adjust <- params$creatinine_adjust  # optional TRUE/FALSE
age_column <- params$age_column      # cohort-specific age column name (lowercased)
sex_column <- params$sex_column      # cohort-specific sex column name (lowercased)
age_transform <- params$age_transform  # optional R expression for unit conversion (e.g., "mslchronage / 12")

if (is.null(quantiles)) {
  quantiles <- c(0.05, 0.25, 0.50, 0.75, 0.95)
}

tryCatch({
  if (is.null(epi_csv) || !nzchar(epi_csv)) {
    cat(toJSON(list(error = "This cohort has no demographic (epi) data — cannot run quantile regression model."), auto_unbox = TRUE))
    quit(status = 1)
  }

  # Read data
  targeted <- read.csv(targeted_csv, stringsAsFactors = FALSE)
  epi <- read.csv(epi_csv, stringsAsFactors = FALSE)

  names(targeted) <- tolower(names(targeted))
  names(epi) <- tolower(names(epi))

  # Detect PID column in targeted data
  tgt_pid_candidates <- intersect(c("pid", "child_pid", "subject_id"), names(targeted))
  if (length(tgt_pid_candidates) == 0) tgt_pid_candidates <- grep("pid", names(targeted), value = TRUE)
  tgt_pid_col <- if (length(tgt_pid_candidates) > 0) tgt_pid_candidates[1] else "pid"

  # Filter to analyte
  chem <- targeted %>%
    filter(tolower(analyte_code) == tolower(analyte))

  if (nrow(chem) == 0) {
    cat(toJSON(list(error = paste0("Analyte '", analyte, "' not found.")), auto_unbox = TRUE))
    quit(status = 1)
  }

  # LOD handling: impute <LOD as LOD/2
  if ("comment_code" %in% names(chem) && "lod" %in% names(chem)) {
    below_lod <- !is.na(chem$comment_code) & chem$comment_code %in% c(37, 199)
    pct_below <- sum(below_lod, na.rm = TRUE) / nrow(chem) * 100
    if (pct_below <= 25) {
      lod_val <- median(chem$lod[chem$lod > 0], na.rm = TRUE)
      if (!is.na(lod_val) && lod_val > 0) {
        chem$concentration[below_lod] <- lod_val / 2
      }
    }
  }

  # Creatinine adjustment if requested
  if (!is.null(creatinine_adjust) && creatinine_adjust) {
    cre_dat <- targeted %>% filter(tolower(analyte_code) == "cre")
    if (nrow(cre_dat) > 0) {
      cre_dat$pid_cre <- tolower(as.character(cre_dat[[tgt_pid_col]]))
      chem$pid_cre <- tolower(as.character(chem[[tgt_pid_col]]))
      chem <- merge(chem, cre_dat[, c("pid_cre", "concentration")],
                    by = "pid_cre", suffixes = c("", ".cre"))
      cre_val <- as.numeric(chem$concentration.cre)
      valid <- !is.na(cre_val) & cre_val > 0
      chem <- chem[valid, ]
      chem$concentration <- as.numeric(chem$concentration) / cre_val[valid] * 100
    }
  }

  # Merge with epi data on PID (epi may use child_pid, subject_id, etc.)
  chem$pid_join <- tolower(as.character(chem[[tgt_pid_col]]))
  epi_pid_col <- intersect(c("pid", "child_pid", "subject_id"), names(epi))
  if (length(epi_pid_col) == 0) epi_pid_col <- grep("pid", names(epi), value = TRUE)
  if (length(epi_pid_col) == 0) stop("No PID column found in epi data")
  epi$pid_join <- tolower(as.character(epi[[epi_pid_col[1]]]))
  merged <- merge(chem, epi, by = "pid_join", suffixes = c("", ".epi"))

  # Prepare model data
  merged$conc <- as.numeric(merged$concentration)

  # Resolve age column: use provided mapping, transform, or default
  if (!is.null(age_transform) && nzchar(age_transform)) {
    merged$age_val <- eval(parse(text = age_transform), envir = merged)
  } else if (!is.null(age_column) && age_column %in% names(merged)) {
    merged$age_val <- as.numeric(merged[[age_column]])
  } else if ("age" %in% names(merged)) {
    merged$age_val <- as.numeric(merged$age)
  }

  # Resolve sex column: use provided mapping or search common names
  if (!is.null(sex_column) && sex_column %in% names(merged)) {
    merged$sex_val <- as.factor(merged[[sex_column]])
  } else {
    sex_col <- intersect(c("sex", "gender", "gender_form03"), names(merged))
    if (length(sex_col) > 0) {
      merged$sex_val <- as.factor(merged[[sex_col[1]]])
    }
  }

  # Remove NAs
  model_vars <- c("conc", "age_val")
  has_sex <- "sex_val" %in% names(merged)
  if (has_sex) model_vars <- c(model_vars, "sex_val")
  merged <- merged[complete.cases(merged[, model_vars, drop = FALSE]), ]

  # Drop sex from model if only 1 level (e.g., all-female cohort)
  if (has_sex && length(unique(merged$sex_val)) < 2) {
    has_sex <- FALSE
  }

  if (nrow(merged) < 10) {
    cat(toJSON(list(error = paste0("Insufficient data after merge (n=", nrow(merged), ").")), auto_unbox = TRUE))
    quit(status = 1)
  }

  # Build formula
  if (has_sex && (is.null(population) || tolower(population) != "adult")) {
    formula_str <- "conc ~ age_val + sex_val"
  } else {
    formula_str <- "conc ~ age_val"
  }
  fml <- as.formula(formula_str)

  # Run quantile regression at each τ
  results <- list()
  for (tau in quantiles) {
    fit <- rq(fml, data = merged, tau = tau)
    smry <- summary(fit, se = "nid")

    coefs <- as.data.frame(smry$coefficients)
    coefs$term <- rownames(coefs)
    names(coefs) <- c("estimate", "std_error", "t_value", "p_value", "term")

    results[[length(results) + 1]] <- list(
      tau = tau,
      coefficients = lapply(1:nrow(coefs), function(i) {
        list(
          term = coefs$term[i],
          estimate = round(coefs$estimate[i], 6),
          std_error = round(coefs$std_error[i], 6),
          p_value = coefs$p_value[i]
        )
      }),
      predicted_quantile = {
        nd <- data.frame(age_val = median(merged$age_val, na.rm = TRUE))
        if (has_sex) nd$sex_val <- factor(levels(merged$sex_val)[1], levels = levels(merged$sex_val))
        round(predict(fit, newdata = nd)[1], 6)
      }
    )
  }

  # Also compute raw percentiles for comparison
  raw_pctiles <- quantile(merged$conc, probs = quantiles, na.rm = TRUE)

  units_val <- unique(chem$units)
  units_val <- units_val[!is.na(units_val)][1]

  output <- list(
    analyte = analyte,
    n = nrow(merged),
    model = formula_str,
    quantile_results = results,
    raw_percentiles = as.list(setNames(round(as.numeric(raw_pctiles), 6), paste0("p", quantiles * 100))),
    units = units_val,
    age_range = list(min = min(merged$age_val, na.rm = TRUE), max = max(merged$age_val, na.rm = TRUE)),
    method = "Conditional quantile regression via quantreg::rq()"
  )

  cat(toJSON(output, auto_unbox = TRUE, null = "null"))

}, error = function(e) {
  cat(toJSON(list(error = conditionMessage(e)), auto_unbox = TRUE))
  quit(status = 1)
})
