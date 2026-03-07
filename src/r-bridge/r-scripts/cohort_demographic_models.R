#!/usr/bin/env Rscript
# Within-cohort demographic model for HHEAR
# Simple model: exposure ~ age + sex + sampling_year
# Uses quantile regression at τ ∈ {0.05, 0.25, 0.5, 0.75, 0.95}

suppressPackageStartupMessages({
  library(jsonlite)
  library(quantreg)
  library(dplyr)
})

params <- fromJSON(file("stdin"))

targeted_csv <- params$targeted_csv
epi_csv <- params$epi_csv
analyte <- params$analyte
quantiles <- params$quantiles
creatinine_adjust <- params$creatinine_adjust  # optional TRUE/FALSE
age_column <- params$age_column      # cohort-specific age column name (lowercased)
sex_column <- params$sex_column      # cohort-specific sex column name (lowercased)
age_transform <- params$age_transform  # optional R expression for unit conversion

if (is.null(quantiles)) {
  quantiles <- c(0.05, 0.25, 0.50, 0.75, 0.95)
}

tryCatch({
  if (is.null(epi_csv) || !nzchar(epi_csv)) {
    cat(toJSON(list(error = "This cohort has no demographic (epi) data — cannot run demographic model."), auto_unbox = TRUE))
    quit(status = 1)
  }

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

  # LOD imputation
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

  # Merge (epi may use child_pid, subject_id, etc.)
  chem$pid_join <- tolower(as.character(chem[[tgt_pid_col]]))
  epi_pid_col <- intersect(c("pid", "child_pid", "subject_id"), names(epi))
  if (length(epi_pid_col) == 0) epi_pid_col <- grep("pid", names(epi), value = TRUE)
  if (length(epi_pid_col) == 0) stop("No PID column found in epi data")
  epi$pid_join <- tolower(as.character(epi[[epi_pid_col[1]]]))
  merged <- merge(chem, epi, by = "pid_join", suffixes = c("", ".epi"))

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
  has_sex <- FALSE
  if (!is.null(sex_column) && sex_column %in% names(merged)) {
    merged$sex_val <- as.factor(merged[[sex_column]])
    has_sex <- nlevels(merged$sex_val) >= 2
  } else {
    sex_col <- intersect(c("sex", "gender", "gender_form03"), names(merged))
    has_sex <- length(sex_col) > 0
    if (has_sex) {
      merged$sex_val <- as.factor(merged[[sex_col[1]]])
      has_sex <- nlevels(merged$sex_val) >= 2
    }
  }

  # Detect sampling year
  year_col <- intersect(c("sample_collection_year", "sample_collection_year.epi"), names(merged))
  has_year <- length(year_col) > 0
  if (has_year) {
    merged$year_val <- as.numeric(merged[[year_col[1]]])
  }

  # Build formula components
  formula_terms <- "age_val"
  if (has_sex) formula_terms <- paste(formula_terms, "+ sex_val")
  if (has_year) formula_terms <- paste(formula_terms, "+ year_val")
  formula_str <- paste("conc ~", formula_terms)
  fml <- as.formula(formula_str)

  # Remove NAs from model columns
  model_cols <- c("conc", "age_val")
  if (has_sex) model_cols <- c(model_cols, "sex_val")
  if (has_year) model_cols <- c(model_cols, "year_val")
  merged <- merged[complete.cases(merged[, model_cols, drop = FALSE]), ]

  if (nrow(merged) < 10) {
    cat(toJSON(list(error = paste0("Insufficient data (n=", nrow(merged), ").")), auto_unbox = TRUE))
    quit(status = 1)
  }

  # Fit null model for pseudo R²
  null_fml <- as.formula("conc ~ 1")

  results <- list()
  for (tau in quantiles) {
    fit <- rq(fml, data = merged, tau = tau)
    null_fit <- rq(null_fml, data = merged, tau = tau)
    smry <- summary(fit, se = "nid")

    coefs <- as.data.frame(smry$coefficients)
    coefs$term <- rownames(coefs)
    names(coefs) <- c("estimate", "std_error", "t_value", "p_value", "term")

    # McFadden's pseudo R² = 1 - sum(rho_tau(resid_full)) / sum(rho_tau(resid_null))
    rho <- function(u, tau) u * (tau - (u < 0))
    r2 <- 1 - sum(rho(fit$residuals, tau)) / sum(rho(null_fit$residuals, tau))

    results[[length(results) + 1]] <- list(
      tau = tau,
      pseudo_r_squared = round(r2, 6),
      coefficients = lapply(1:nrow(coefs), function(i) {
        list(
          term = coefs$term[i],
          estimate = round(coefs$estimate[i], 6),
          std_error = round(coefs$std_error[i], 6),
          p_value = coefs$p_value[i]
        )
      })
    )
  }

  output <- list(
    analyte = analyte,
    n = nrow(merged),
    model = formula_str,
    quantile_results = results,
    method = "Quantile regression via quantreg::rq(); pseudo R² = McFadden's"
  )

  cat(toJSON(output, auto_unbox = TRUE, null = "null"))

}, error = function(e) {
  cat(toJSON(list(error = conditionMessage(e)), auto_unbox = TRUE))
  quit(status = 1)
})
