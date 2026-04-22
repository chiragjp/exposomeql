#!/usr/bin/env Rscript
# Conditional reference intervals via quantile regression on NHANES.
# Fits biomarker ~ age + sex at τ ∈ {0.025, 0.05, 0.25, 0.50, 0.75, 0.95, 0.975}
# with survey weights, then predicts at user-specified age/sex to return
# "what's normal for someone like me?" intervals.

suppressPackageStartupMessages({
  library(jsonlite)
  library(DBI)
  library(RSQLite)
  library(dplyr)
  library(quantreg)
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

biomarker    <- params$biomarker        # NHANES variable name
predict_age  <- params$predict_age      # numeric or numeric vector
predict_sex  <- params$predict_sex      # 1=male, 2=female, or "both"
taus         <- params$taus             # numeric vector, or NULL
cycles       <- params$cycles           # series letters, or NULL
age_spline   <- params$age_spline       # TRUE/FALSE — use age + age² (default TRUE)

if (is.null(taus)) taus <- c(0.025, 0.05, 0.25, 0.50, 0.75, 0.95, 0.975)
if (is.null(age_spline)) age_spline <- TRUE
if (is.null(predict_sex)) predict_sex <- "both"

con <- connect_pewas_data(db_path)

if (is.null(cycles)) {
  tab_info <- get_table_names_for_varname(con, biomarker)
  yr2s <- c("1999"="A","2001"="B","2003"="C","2005"="D","2007"="E","2009"="F",
            "2011"="G","2013"="H","2015"="I","2017"="J")
  cycles <- tail(sort(unique(yr2s[as.character(tab_info$Begin.Year)])), 3)
}

yr_from_letter <- c("A"=1999,"B"=2001,"C"=2003,"D"=2005,"E"=2007,"F"=2009,
                    "G"=2011,"H"=2013,"I"=2015,"J"=2017)

tryCatch({
  # Pool data across cycles — load biomarker + DEMO
  pooled <- NULL
  for (s in cycles) {
    tab_obj <- tryCatch(get_tables(biomarker, biomarker, s, con), error = function(e) NULL)
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
    cat(toJSON(list(error = "No data found for specified biomarker and cycles"), auto_unbox = TRUE))
    quit(status = 1)
  }

  # Weight adjustment
  n_cycles <- length(unique(pooled$series))
  if (n_cycles > 1) {
    if (n_cycles == 2 && all(c("A","B") %in% unique(pooled$series)) && "WTMEC4YR" %in% names(pooled)) {
      pooled$wt <- pooled$WTMEC4YR
    } else {
      pooled$wt <- pooled$wt / n_cycles
    }
  }

  # Require age + sex + biomarker + weight
  required <- c(biomarker, "RIDAGEYR", "RIAGENDR", "wt")
  pooled <- pooled[complete.cases(pooled[, intersect(required, names(pooled)), drop = FALSE]), ]
  pooled <- pooled[pooled$wt > 0, ]

  if (nrow(pooled) < 50) {
    cat(toJSON(list(error = paste0("Insufficient sample size (n=", nrow(pooled), "). Need >= 50.")), auto_unbox = TRUE))
    quit(status = 1)
  }

  pooled$sex <- as.factor(pooled$RIAGENDR)
  pooled$age <- pooled$RIDAGEYR
  pooled$y <- pooled[[biomarker]]

  # Build formula
  if (age_spline) {
    fml <- y ~ age + I(age^2) + sex
  } else {
    fml <- y ~ age + sex
  }

  # Fit at each tau
  qr_results <- list()
  for (tau in taus) {
    fit <- rq(fml, data = pooled, tau = tau, weights = pooled$wt)
    smry <- summary(fit, se = "nid")

    coefs <- as.data.frame(smry$coefficients)
    coefs$term <- rownames(coefs)
    names(coefs) <- c("estimate", "std_error", "t_value", "p_value", "term")

    qr_results[[length(qr_results) + 1]] <- list(
      tau = tau,
      fit = fit,
      coefficients = lapply(seq_len(nrow(coefs)), function(i) {
        list(
          term = coefs$term[i],
          estimate = round(coefs$estimate[i], 6),
          std_error = round(coefs$std_error[i], 6),
          p_value = coefs$p_value[i]
        )
      })
    )
  }

  # Build prediction grid
  if (is.null(predict_age)) {
    predict_age <- c(20, 30, 40, 50, 60, 70)
  }

  sex_levels <- levels(pooled$sex)
  if (predict_sex == "both") {
    sex_vals <- sex_levels
  } else {
    sex_vals <- as.character(predict_sex)
  }

  sex_labels <- c("1" = "Male", "2" = "Female")

  predictions <- list()
  for (sx in sex_vals) {
    for (ag in predict_age) {
      nd <- data.frame(age = ag, sex = factor(sx, levels = sex_levels))

      pred_row <- list(
        age = ag,
        sex = sx,
        sex_label = ifelse(sx %in% names(sex_labels), sex_labels[sx], sx)
      )

      for (qr in qr_results) {
        pred_val <- predict(qr$fit, newdata = nd)[1]
        key <- paste0("p", round(qr$tau * 100, 1))
        pred_row[[key]] <- round(pred_val, 4)
      }

      # Compute the 95% reference interval (2.5th–97.5th) and 90% (5th–95th)
      pred_row$ref_interval_95 <- list(
        lower = pred_row$p2.5,
        upper = pred_row$p97.5
      )
      pred_row$ref_interval_90 <- list(
        lower = pred_row$p5,
        upper = pred_row$p95
      )

      predictions[[length(predictions) + 1]] <- pred_row
    }
  }

  # Population summary for context
  pop_summary <- list(
    mean = round(weighted.mean(pooled$y, pooled$wt, na.rm = TRUE), 4),
    sd = round(sqrt(sum(pooled$wt * (pooled$y - weighted.mean(pooled$y, pooled$wt))^2) / sum(pooled$wt)), 4),
    n = nrow(pooled),
    age_range = list(min = min(pooled$age), max = max(pooled$age)),
    raw_percentiles = as.list(setNames(
      round(as.numeric(quantile(pooled$y, probs = taus, na.rm = TRUE)), 4),
      paste0("p", round(taus * 100, 1))
    ))
  )

  output <- list(
    biomarker = biomarker,
    model = deparse(fml),
    n = nrow(pooled),
    cycles_used = unique(pooled$series),
    n_cycles = n_cycles,
    taus = taus,
    predictions = predictions,
    population_summary = pop_summary,
    coefficients_by_tau = lapply(qr_results, function(qr) {
      list(tau = qr$tau, coefficients = qr$coefficients)
    }),
    note = "Conditional reference intervals via survey-weighted quantile regression (quantreg::rq). Predictions show the expected quantile of the biomarker distribution for a person of specified age and sex in the NHANES population. The 95% reference interval (p2.5–p97.5) corresponds to the clinical 'normal range'. These are population-level distributions, not individual predictions."
  )

  cat(toJSON(output, auto_unbox = TRUE, null = "null"))

}, error = function(e) {
  cat(toJSON(list(error = conditionMessage(e)), auto_unbox = TRUE))
  quit(status = 1)
}, finally = {
  try(disconnect_pewas_data(con), silent = TRUE)
})
