#!/usr/bin/env Rscript
# Stratified ExWAS: loop exposures within each stratum of a categorical
# modifier (sex, age tertile, race, or any custom NHANES variable).
#
# Each (exposure, stratum) cell gets its own survey-weighted regression so per-
# stratum βs are directly comparable. A separate pooled model with an explicit
# exposure × stratifier interaction term yields a clean interaction p — better
# than Cochran-Q meta-analysis across two-or-three-level strata which is
# under-powered with small k.

suppressPackageStartupMessages({
  library(jsonlite)
  library(survey)
  library(DBI)
  library(RSQLite)
  library(dplyr)
  library(broom)
})

`%||%` <- function(a, b) {
  if (is.null(a)) return(b)
  if (is.character(a) && length(a) == 1 && !nzchar(a)) return(b)
  a
}

params <- if (exists("POOL_PARAMS", envir = globalenv())) get("POOL_PARAMS", envir = globalenv()) else fromJSON(file("stdin"))
db_path <- Sys.getenv("EXPOSOMEQL_DB_PATH")

# Inputs
handle_csv     <- params$phenotype_handle_csv
outcome_var    <- params$outcome
outcome_name   <- params$outcome_name %||% (if (!is.null(outcome_var)) outcome_var else "derived_phenotype")
phenotype_type <- params$phenotype_type %||% "continuous"
exposures      <- params$exposures
stratify_by    <- params$stratify_by %||% "sex"          # sex | age_tertile | race | <varname>
age_cuts       <- params$age_cuts                         # optional custom age cuts (e.g. c(40,65))
cycles         <- params$cycles
id_col         <- params$id_column     %||% "SEQN"
wt_col         <- params$weight_column %||% "wt_pooled"
psu_col        <- params$psu_column    %||% "SDMVPSU"
str_col        <- params$strata_column %||% "SDMVSTRA"
has_survey     <- isTRUE(params$has_survey_design) || is.null(params$has_survey_design)
is_binary      <- phenotype_type == "binary"

if (is.null(exposures) || length(exposures) == 0) {
  cat(toJSON(list(error = "No exposures provided"), auto_unbox = TRUE)); quit(status = 1)
}

con <- dbConnect(SQLite(), db_path)

# ─── 1. Load outcome side ───────────────────────────────────────────────
load_handle <- function(path) {
  d <- read.csv(path)
  names(d)[names(d) == "value"] <- outcome_name
  d
}

load_nhanes_outcome <- function(varname, cycles_arg) {
  cat_info <- tryCatch(
    dbGetQuery(con,
      'SELECT "Data.File.Name" AS f, "Begin.Year" AS y FROM variable_names_epcf WHERE "Variable.Name"=?',
      params = list(varname)),
    error = function(e) NULL)
  if (is.null(cat_info) || nrow(cat_info) == 0) return(NULL)
  cat_info <- cat_info[!grepl("^P_", cat_info$f), ]
  yr2s <- c("A"=1999,"B"=2001,"C"=2003,"D"=2005,"E"=2007,"F"=2009,
            "G"=2011,"H"=2013,"I"=2015,"J"=2017)
  if (is.null(cycles_arg)) cycles_arg <- names(yr2s)
  base <- NULL
  demo_keep <- c("SEQN","RIDAGEYR","RIAGENDR","RIDRETH3","INDFMPIR","DMDEDUC2",
                 "WTMEC2YR","SDMVPSU","SDMVSTRA")
  for (s in cycles_arg) {
    yr <- yr2s[s]
    row <- cat_info[!is.na(cat_info$y) & cat_info$y == yr, ]
    if (nrow(row) == 0) next
    demo <- tryCatch(dbReadTable(con, paste0("DEMO_", s)), error = function(e) NULL)
    tab  <- tryCatch(dbReadTable(con, row$f[1]), error = function(e) NULL)
    if (is.null(demo) || is.null(tab) || !(varname %in% names(tab))) next
    dk <- intersect(demo_keep, names(demo))
    d <- demo[, dk]
    d$cycle <- s
    d <- merge(d, tab[, c("SEQN", varname)], by = "SEQN", all.x = FALSE)
    # Align columns before rbind — demographic columns (e.g. RIDRETH3, only
    # present from 2011/G onward) differ across cycles, so a naive rbind throws
    # "numbers of columns of arguments do not match" when pooling.
    if (is.null(base)) base <- d
    else { cc <- intersect(names(base), names(d)); base <- rbind(base[, cc, drop = FALSE], d[, cc, drop = FALSE]) }
  }
  if (is.null(base) || nrow(base) == 0) return(NULL)
  names(base)[names(base) == varname] <- outcome_name
  n_cycles <- length(unique(base$cycle))
  base$wt_pooled <- base$WTMEC2YR / max(1, n_cycles)
  base
}

base <- if (!is.null(handle_csv) && file.exists(handle_csv)) {
  load_handle(handle_csv)
} else if (!is.null(outcome_var) && nzchar(outcome_var)) {
  load_nhanes_outcome(outcome_var, cycles)
} else {
  NULL
}
if (is.null(base) || nrow(base) == 0) {
  cat(toJSON(list(error = "could not load outcome data"), auto_unbox = TRUE)); quit(status = 1)
}
has_cycle <- "cycle" %in% names(base)
cycles_used <- if (has_cycle) unique(base$cycle) else character(0)

# ─── 2. Derive stratifier column ────────────────────────────────────────
weighted_quantile <- function(x, w, probs) {
  ok <- !is.na(x) & !is.na(w) & w > 0
  if (sum(ok) == 0) return(rep(NA_real_, length(probs)))
  x <- x[ok]; w <- w[ok]
  ord <- order(x)
  x <- x[ord]; w <- w[ord]
  cw <- cumsum(w) / sum(w)
  out <- sapply(probs, function(p) {
    idx <- which(cw >= p)[1]
    if (is.na(idx)) tail(x, 1) else x[idx]
  })
  out
}

if (stratify_by == "sex") {
  if (!("RIAGENDR" %in% names(base))) {
    cat(toJSON(list(error = "RIAGENDR not available in outcome data"), auto_unbox = TRUE)); quit(status = 1)
  }
  base$stratum <- ifelse(base$RIAGENDR == 1, "male",
                  ifelse(base$RIAGENDR == 2, "female", NA_character_))
  stratifier_term <- "RIAGENDR"
  stratifier_var  <- "RIAGENDR"
} else if (stratify_by == "age_tertile") {
  if (!("RIDAGEYR" %in% names(base))) {
    cat(toJSON(list(error = "RIDAGEYR not available"), auto_unbox = TRUE)); quit(status = 1)
  }
  cuts <- if (!is.null(age_cuts) && length(age_cuts) >= 1) {
    sort(unique(as.numeric(age_cuts)))
  } else {
    w <- if ("wt_pooled" %in% names(base)) base$wt_pooled else rep(1, nrow(base))
    weighted_quantile(base$RIDAGEYR, w, c(1/3, 2/3))
  }
  brks <- c(-Inf, cuts, Inf)
  labs <- if (length(cuts) == 2) {
    c(sprintf("<%d", round(cuts[1])),
      sprintf("%d-%d", round(cuts[1]), round(cuts[2])),
      sprintf(">=%d", round(cuts[2])))
  } else {
    sapply(seq_along(brks)[-1], function(i) {
      lo <- brks[i-1]; hi <- brks[i]
      if (is.infinite(lo)) sprintf("<%d", round(hi))
      else if (is.infinite(hi)) sprintf(">=%d", round(lo))
      else sprintf("%d-%d", round(lo), round(hi))
    })
  }
  base$stratum <- as.character(cut(base$RIDAGEYR, breaks = brks, labels = labs, include.lowest = TRUE, right = FALSE))
  # Create a numeric copy of stratum for interaction modeling
  base$stratum_num <- as.numeric(factor(base$stratum, levels = labs))
  stratifier_term <- "factor(stratum_num)"
  stratifier_var  <- "stratum_num"
} else if (stratify_by == "race") {
  if (!("RIDRETH3" %in% names(base))) {
    cat(toJSON(list(error = "RIDRETH3 not available"), auto_unbox = TRUE)); quit(status = 1)
  }
  race_map <- c("1" = "Mexican_American", "2" = "Other_Hispanic", "3" = "NH_White",
                "4" = "NH_Black", "6" = "NH_Asian", "7" = "Other")
  base$stratum <- race_map[as.character(base$RIDRETH3)]
  base$stratum_num <- base$RIDRETH3
  stratifier_term <- "factor(RIDRETH3)"
  stratifier_var  <- "RIDRETH3"
} else {
  # Custom variable; assume already present in base
  if (!(stratify_by %in% names(base))) {
    cat(toJSON(list(error = paste0("custom stratifier '", stratify_by, "' not in outcome data")), auto_unbox = TRUE))
    quit(status = 1)
  }
  base$stratum <- as.character(base[[stratify_by]])
  base$stratum_num <- as.numeric(factor(base$stratum))
  stratifier_term <- paste0("factor(", stratify_by, ")")
  stratifier_var  <- stratify_by
}

base <- base[!is.na(base$stratum) & nzchar(base$stratum), ]
strata_levels <- unique(base$stratum)
if (length(strata_levels) < 2) {
  cat(toJSON(list(error = paste0("stratifier produced ", length(strata_levels), " levels; need >=2")), auto_unbox = TRUE))
  quit(status = 1)
}

# ─── 3. Exposure loader (handles cycle nesting) ────────────────────────
yr2s <- c("A"=1999,"B"=2001,"C"=2003,"D"=2005,"E"=2007,"F"=2009,
          "G"=2011,"H"=2013,"I"=2015,"J"=2017)
load_exposure <- function(expo) {
  cat_info <- tryCatch(
    dbGetQuery(con,
      'SELECT "Data.File.Name" AS f, "Begin.Year" AS y FROM variable_names_epcf WHERE "Variable.Name"=?',
      params = list(expo)),
    error = function(e) NULL)
  if (is.null(cat_info) || nrow(cat_info) == 0) return(NULL)
  cat_info <- cat_info[!grepl("^P_", cat_info$f), ]
  if (nrow(cat_info) == 0) return(NULL)
  if (!has_cycle) {
    tab <- tryCatch(dbReadTable(con, cat_info$f[1]), error = function(e) NULL)
    if (is.null(tab) || !(expo %in% names(tab)) || !(id_col %in% names(tab))) return(NULL)
    return(tab[, c(id_col, expo)])
  }
  out <- NULL
  for (s in cycles_used) {
    yr <- yr2s[s]
    row <- cat_info[!is.na(cat_info$y) & cat_info$y == yr, ]
    if (nrow(row) == 0) next
    tab <- tryCatch(dbReadTable(con, row$f[1]), error = function(e) NULL)
    if (is.null(tab) || !(expo %in% names(tab)) || !(id_col %in% names(tab))) next
    sub <- tab[, c(id_col, expo)]
    sub$cycle <- s
    out <- rbind(out, sub)
  }
  out
}

# ─── 4. Per-exposure fit (subset + interaction model) ──────────────────
options(survey.lonely.psu = "adjust")

fit_one <- function(expo) {
  edat <- load_exposure(expo)
  if (is.null(edat) || nrow(edat) == 0) return(list(status = "skip", reason = "no data"))
  merge_keys <- if (has_cycle && "cycle" %in% names(edat)) c(id_col, "cycle") else id_col
  m <- merge(base, edat, by = merge_keys, all.x = FALSE)
  m <- m[!is.na(m[[outcome_name]]) & !is.na(m[[expo]]), ]
  if (has_survey && wt_col %in% names(m)) m <- m[!is.na(m[[wt_col]]) & m[[wt_col]] > 0, ]
  if (nrow(m) < 60) return(list(status = "skip", reason = paste0("n<60 after merge")))

  ev <- m[[expo]]
  n_unique <- length(unique(ev[!is.na(ev)]))
  is_cat_expo <- n_unique <= 5 && all(ev[!is.na(ev)] %% 1 == 0)

  if (is_cat_expo) {
    m[[expo]] <- as.factor(m[[expo]])
    tab <- sort(table(m[[expo]]), decreasing = TRUE)
    m[[expo]] <- relevel(m[[expo]], ref = names(tab)[1])
    expo_term <- expo
  } else {
    pos <- ev[!is.na(ev) & ev > 0]
    eps <- if (length(pos) > 0) min(pos) / 2 else 1e-6
    m$expo_t <- as.numeric(scale(log10(pmax(ev, 0) + eps)))
    expo_term <- "expo_t"
  }

  covariates <- c()
  if ("RIDAGEYR" %in% names(m) && stratifier_var != "RIDAGEYR") covariates <- c(covariates, "RIDAGEYR", "I(RIDAGEYR^2)")
  if ("RIAGENDR" %in% names(m) && stratifier_var != "RIAGENDR") {
    m$RIAGENDR <- as.factor(m$RIAGENDR); covariates <- c(covariates, "RIAGENDR")
  }
  if ("RIDRETH3" %in% names(m) && stratifier_var != "RIDRETH3") {
    m$RIDRETH3 <- as.factor(m$RIDRETH3); covariates <- c(covariates, "RIDRETH3")
  }

  use_survey <- has_survey && all(c(psu_col, str_col, wt_col) %in% names(m))

  build_design <- function(d) {
    svydesign(
      ids = as.formula(paste0("~", psu_col)),
      strata = as.formula(paste0("~", str_col)),
      weights = as.formula(paste0("~", wt_col)),
      nest = TRUE, data = d)
  }
  fit_svy <- function(d, fml) {
    dsn <- build_design(d)
    if (is_binary) svyglm(fml, design = dsn, family = quasibinomial())
    else svyglm(fml, design = dsn)
  }
  fit_glm <- function(d, fml) {
    if (is_binary) glm(fml, data = d, family = binomial())
    else lm(fml, data = d)
  }

  # Per-stratum fits
  per_stratum <- list()
  for (lvl in strata_levels) {
    sub <- m[m$stratum == lvl, ]
    if (nrow(sub) < 30) {
      per_stratum[[lvl]] <- list(stratum = lvl, status = "skip", reason = paste0("n<30 (", nrow(sub), ")"))
      next
    }
    fml_sub <- as.formula(paste0(outcome_name, " ~ ", paste(c(expo_term, covariates), collapse = " + ")))
    fit <- tryCatch(if (use_survey) fit_svy(sub, fml_sub) else fit_glm(sub, fml_sub),
                    error = function(e) NULL)
    if (is.null(fit)) {
      per_stratum[[lvl]] <- list(stratum = lvl, status = "err", reason = "fit failed")
      next
    }
    tidied <- tryCatch(tidy(fit), error = function(e) NULL)
    if (is.null(tidied)) { per_stratum[[lvl]] <- list(stratum = lvl, status = "err", reason = "tidy failed"); next }
    pattern <- paste0("^", if (is_cat_expo) expo else expo_term)
    er <- tidied[grepl(pattern, tidied$term), , drop = FALSE]
    if (nrow(er) == 0) {
      per_stratum[[lvl]] <- list(stratum = lvl, status = "err", reason = "no coef")
      next
    }
    if (nrow(er) > 1) er <- er[order(er$p.value), , drop = FALSE]
    r <- er[1, ]
    per_stratum[[lvl]] <- list(
      stratum = lvl,
      status = "ok",
      n = nrow(sub),
      estimate = round(as.numeric(r$estimate), 6),
      std_error = round(as.numeric(r$std.error), 6),
      p_value = as.numeric(r$p.value),
      exposure_type = if (is_cat_expo) "categorical" else "continuous"
    )
  }

  # Pooled interaction model — exposure × stratifier on the full merged dataset
  interaction_p <- NA_real_
  interaction_term_label <- NA_character_
  if (!is_cat_expo) {
    # Treat stratifier_term symbolically; require both expo + stratum_num/RIAGENDR present
    fml_int <- as.formula(paste0(outcome_name, " ~ ", expo_term, " * ", stratifier_term,
                                 if (length(covariates) > 0) paste0(" + ", paste(covariates, collapse = " + ")) else ""))
    fit_int <- tryCatch(if (use_survey) fit_svy(m, fml_int) else fit_glm(m, fml_int),
                        error = function(e) NULL)
    if (!is.null(fit_int)) {
      tidied <- tryCatch(tidy(fit_int), error = function(e) NULL)
      if (!is.null(tidied)) {
        int_rows <- tidied[grepl(":", tidied$term) & grepl(expo_term, tidied$term), , drop = FALSE]
        if (nrow(int_rows) > 0) {
          int_rows <- int_rows[order(int_rows$p.value), , drop = FALSE]
          interaction_p <- as.numeric(int_rows$p.value[1])
          interaction_term_label <- as.character(int_rows$term[1])
        }
      }
    }
  }

  list(
    status = "ok",
    exposure = expo,
    n_total = nrow(m),
    exposure_type = if (is_cat_expo) "categorical" else "continuous",
    per_stratum = per_stratum,
    interaction_p = interaction_p,
    interaction_term = interaction_term_label
  )
}

results <- list()
errors <- character()

tryCatch({
  for (expo in exposures) {
    out <- tryCatch(fit_one(expo), error = function(e) list(status = "err", reason = conditionMessage(e)))
    if (is.null(out) || identical(out$status, "err")) {
      errors <- c(errors, paste0(expo, ": ", out$reason %||% "unknown error"))
    } else if (identical(out$status, "skip")) {
      errors <- c(errors, paste0(expo, ": ", out$reason))
    } else {
      results[[length(results) + 1]] <- out
    }
  }

  # BH-FDR on interaction p-values across exposures
  if (length(results) > 0) {
    int_ps <- sapply(results, function(x) x$interaction_p)
    valid <- is.finite(int_ps)
    if (sum(valid) > 0) {
      ps_valid <- int_ps[valid]
      adj <- p.adjust(ps_valid, method = "BH")
      bonf <- pmin(ps_valid * sum(valid), 1)
      j <- 0
      for (i in seq_along(results)) {
        if (valid[i]) {
          j <- j + 1
          results[[i]]$interaction_p_bonferroni <- bonf[j]
          results[[i]]$interaction_p_fdr_bh <- adj[j]
        }
      }
    }
    # Sort by smallest interaction p
    ord <- order(sapply(results, function(x) ifelse(is.finite(x$interaction_p), x$interaction_p, Inf)))
    results <- results[ord]
  }

  cat(toJSON(list(
    outcome = outcome_name,
    phenotype_type = phenotype_type,
    stratifier = stratify_by,
    stratifier_levels = strata_levels,
    n_strata = length(strata_levels),
    n_exposures_tested = length(exposures),
    n_results = length(results),
    n_errors = length(errors),
    cycles_used = cycles_used,
    results = results,
    errors = if (length(errors) > 0) errors else NULL,
    note = "Per-stratum fits use survey-weighted regression with model-6 covariates (excluding the stratifier itself). Interaction p comes from a single pooled model with exposure × stratifier term. BH-FDR + Bonferroni applied across exposures on the interaction p-values."
  ), auto_unbox = TRUE, null = "null"))
}, error = function(e) {
  cat(toJSON(list(error = conditionMessage(e)), auto_unbox = TRUE))
  quit(status = 1)
}, finally = {
  try(dbDisconnect(con), silent = TRUE)
})
