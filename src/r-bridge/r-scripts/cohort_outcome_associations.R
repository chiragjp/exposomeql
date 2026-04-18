#!/usr/bin/env Rscript
# cohort_outcome_associations.R
# Phenotype-wide association study for a single exposure in an HHEAR cohort.
# Tests one exposure against ALL numeric outcomes in the epi data.
# Model: outcome ~ ln(exposure) + covariates
# Returns ranked associations with BH-FDR correction.

suppressPackageStartupMessages({
  library(jsonlite)
})

# Read JSON input from stdin
input <- if (exists("POOL_PARAMS", envir = globalenv())) get("POOL_PARAMS", envir = globalenv()) else fromJSON(file("stdin"))

targeted_csv <- input$targeted_csv
epi_csv      <- input$epi_csv
analyte_code <- input$analyte_code
creatinine_adjust <- isTRUE(input$creatinine_adjust)
age_column   <- input$age_column
sex_column   <- input$sex_column
age_transform <- input$age_transform
covariates   <- input$covariates
wide_format  <- isTRUE(input$wide_format)
pid_column   <- input$pid_column

# Load data
targeted <- read.csv(targeted_csv, stringsAsFactors = FALSE)
epi <- read.csv(epi_csv, stringsAsFactors = FALSE)

# Handle wide vs long format
if (wide_format || !("Analyte_Code" %in% names(targeted))) {
  # Wide format: each column is an analyte
  if (!(analyte_code %in% names(targeted))) {
    cat(toJSON(list(error = paste0("Analyte '", analyte_code, "' not found in targeted data columns: ",
                                    paste(names(targeted), collapse = ", "))), auto_unbox = TRUE))
    quit(status = 0)
  }
  # Create a simple dataframe with PID and the exposure
  exposure_df <- data.frame(
    PID = targeted[[pid_column]],
    exposure = as.numeric(targeted[[analyte_code]]),
    stringsAsFactors = FALSE
  )
  # Get creatinine if needed
  if (creatinine_adjust && "CRE" %in% names(targeted)) {
    exposure_df$CRE <- as.numeric(targeted[["CRE"]])
  }
} else {
  # Long format: filter to analyte
  sub <- targeted[tolower(targeted$Analyte_Code) == tolower(analyte_code), ]
  if (nrow(sub) == 0) {
    cat(toJSON(list(error = paste0("Analyte '", analyte_code, "' not found in targeted data")), auto_unbox = TRUE))
    quit(status = 0)
  }
  exposure_df <- data.frame(
    PID = sub[[pid_column]],
    exposure = as.numeric(sub$Result),
    stringsAsFactors = FALSE
  )
  # Get creatinine
  if (creatinine_adjust) {
    cre_sub <- targeted[tolower(targeted$Analyte_Code) == "cre", ]
    if (nrow(cre_sub) > 0) {
      cre_df <- data.frame(PID = cre_sub[[pid_column]], CRE = as.numeric(cre_sub$Result), stringsAsFactors = FALSE)
      exposure_df <- merge(exposure_df, cre_df, by = "PID", all.x = TRUE)
    }
  }
}

# Creatinine adjustment
if (creatinine_adjust && "CRE" %in% names(exposure_df)) {
  valid_cre <- !is.na(exposure_df$CRE) & exposure_df$CRE > 0
  exposure_df$exposure[valid_cre] <- exposure_df$exposure[valid_cre] / exposure_df$CRE[valid_cre] * 100
}

# Merge with epi data
names(epi)[tolower(names(epi)) == tolower(pid_column)] <- "PID"
names(exposure_df)[1] <- "PID"
dat <- merge(exposure_df, epi, by = "PID")

# Log-transform exposure (handle zeros/negatives)
dat$ln_exposure <- log(pmax(dat$exposure, 0.001))

# Remove rows with missing exposure
dat <- dat[!is.na(dat$ln_exposure) & is.finite(dat$ln_exposure), ]

if (nrow(dat) < 10) {
  cat(toJSON(list(error = "Fewer than 10 observations after merging. Cannot run associations."), auto_unbox = TRUE))
  quit(status = 0)
}

# Identify numeric outcome columns from epi data (exclude IDs, exposure, etc.)
exclude_cols <- c("PID", "pid", pid_column, tolower(pid_column),
                  "exposure", "ln_exposure", "CRE",
                  "sid", "sid_u", "sample_id", "sampleid")
epi_cols <- names(dat)[!tolower(names(dat)) %in% tolower(exclude_cols)]

# Filter to numeric columns with sufficient variation
numeric_outcomes <- c()
for (col in epi_cols) {
  vals <- suppressWarnings(as.numeric(dat[[col]]))
  n_valid <- sum(!is.na(vals))
  n_unique <- length(unique(vals[!is.na(vals)]))
  if (n_valid >= 10 && n_unique >= 3) {
    dat[[col]] <- vals  # ensure numeric
    numeric_outcomes <- c(numeric_outcomes, col)
  }
}

if (length(numeric_outcomes) == 0) {
  cat(toJSON(list(error = "No numeric outcome variables found in epi data with sufficient variation."), auto_unbox = TRUE))
  quit(status = 0)
}

# Build covariate formula part
cov_terms <- c()
if (!is.null(covariates) && length(covariates) > 0) {
  for (cv in covariates) {
    if (cv %in% names(dat)) cov_terms <- c(cov_terms, cv)
  }
} else {
  # Default: age and sex if available
  if (!is.null(age_column) && age_column %in% names(dat)) {
    if (!is.null(age_transform)) {
      dat$age_std <- eval(parse(text = age_transform), envir = dat)
      cov_terms <- c(cov_terms, "age_std")
    } else {
      cov_terms <- c(cov_terms, age_column)
    }
  }
  if (!is.null(sex_column) && sex_column %in% names(dat)) {
    cov_terms <- c(cov_terms, sex_column)
  }
}

cov_formula <- if (length(cov_terms) > 0) paste("+", paste(cov_terms, collapse = " + ")) else ""

# Run associations
results <- list()
for (outcome in numeric_outcomes) {
  # Skip if outcome is the exposure itself or a covariate
  if (outcome %in% c(analyte_code, cov_terms)) next

  formula_str <- paste0("`", outcome, "` ~ ln_exposure ", cov_formula)
  tryCatch({
    model <- lm(as.formula(formula_str), data = dat, na.action = na.omit)
    s <- summary(model)
    if (nrow(s$coefficients) < 2) next  # exposure coefficient not estimated
    coef_row <- s$coefficients[2, ]  # ln_exposure coefficient
    results[[length(results) + 1]] <- list(
      outcome = outcome,
      beta = round(coef_row[1], 5),
      se = round(coef_row[2], 5),
      t_stat = round(coef_row[3], 3),
      p_value = coef_row[4],
      n = nobs(model),
      r_squared = round(s$r.squared, 4),
      direction = ifelse(coef_row[1] > 0, "positive", "negative")
    )
  }, error = function(e) {
    # Skip problematic outcomes
  })
}

if (length(results) == 0) {
  cat(toJSON(list(error = "No outcome associations could be computed."), auto_unbox = TRUE))
  quit(status = 0)
}

# Sort by p-value
results <- results[order(sapply(results, function(x) x$p_value))]

# Apply BH-FDR
pvals <- sapply(results, function(x) x$p_value)
fdr <- p.adjust(pvals, method = "BH")
for (i in seq_along(results)) {
  results[[i]]$fdr_q <- round(fdr[i], 5)
  results[[i]]$fdr_significant <- fdr[i] < 0.1
}

n_fdr_sig <- sum(fdr < 0.1)

output <- list(
  n_outcomes_tested = length(results),
  n_fdr_significant = n_fdr_sig,
  model = paste0("outcome ~ ln(", analyte_code, if (creatinine_adjust) "/CRE*100" else "", ")", cov_formula),
  n_observations = nrow(dat),
  covariates = if (length(cov_terms) > 0) cov_terms else "none",
  associations = results,
  r_code = paste0("lm(", "outcome ~ ln_exposure ", cov_formula, ", data = dat)")
)

cat(toJSON(output, auto_unbox = TRUE, digits = 8))
