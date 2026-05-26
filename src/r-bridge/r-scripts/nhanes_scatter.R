#!/usr/bin/env Rscript
# Exposure × phenotype scatter with smoother.
# Continuous outcomes: subsampled raw points + LOESS line.
# Binary outcomes: decile-binned empirical probability (binomial 95% CI) +
# logistic-fit predicted probability curve.

suppressPackageStartupMessages({
  library(jsonlite)
  library(DBI)
  library(RSQLite)
  library(dplyr)
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
exposure_var   <- params$exposure
phenotype_type <- params$phenotype_type %||% "continuous"
cycles         <- params$cycles
n_points_max   <- as.integer(params$n_points %||% 1500)
n_grid         <- as.integer(params$n_grid %||% 100)
id_col         <- params$id_column     %||% "SEQN"
adjust_for     <- params$adjust_for                         # character vector or NULL
# Pool worker uses simplifyVector=FALSE → arrays arrive as R lists. Coerce.
if (!is.null(adjust_for)) adjust_for <- as.character(unlist(adjust_for))
if (!is.null(cycles))     cycles     <- as.character(unlist(cycles))
# Treat empty array / single empty string as "no adjustment"
if (!is.null(adjust_for) && (length(adjust_for) == 0 ||
    (length(adjust_for) == 1 && is.character(adjust_for) && !nzchar(adjust_for)))) {
  adjust_for <- NULL
}

if (is.null(exposure_var) || !nzchar(exposure_var)) {
  cat(toJSON(list(error = "exposure variable required"), auto_unbox = TRUE)); quit(status = 1)
}

con <- dbConnect(SQLite(), db_path)

# ─── Load outcome side ───
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
  demo_keep <- c("SEQN","RIDAGEYR","RIAGENDR","RIDRETH3","WTMEC2YR","SDMVPSU","SDMVSTRA")
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
    # Align columns before rbind: demographic columns differ across cycles
    # (e.g. RIDRETH3 only exists from 2011/G onward), so a naive rbind throws
    # "numbers of columns of arguments do not match" when pooling pre- and
    # post-2011 cycles. Keep the intersection.
    if (is.null(base)) {
      base <- d
    } else {
      cc <- intersect(names(base), names(d))
      base <- rbind(base[, cc, drop = FALSE], d[, cc, drop = FALSE])
    }
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

# ─── Load exposure side ───
yr2s <- c("A"=1999,"B"=2001,"C"=2003,"D"=2005,"E"=2007,"F"=2009,
          "G"=2011,"H"=2013,"I"=2015,"J"=2017)
cat_info <- tryCatch(
  dbGetQuery(con,
    'SELECT "Data.File.Name" AS f, "Begin.Year" AS y FROM variable_names_epcf WHERE "Variable.Name"=?',
    params = list(exposure_var)),
  error = function(e) NULL)
if (is.null(cat_info) || nrow(cat_info) == 0) {
  cat(toJSON(list(error = paste0("exposure '", exposure_var, "' not in catalog")), auto_unbox = TRUE)); quit(status = 1)
}
cat_info <- cat_info[!grepl("^P_", cat_info$f), ]

edat <- NULL
if (has_cycle) {
  for (s in cycles_used) {
    yr <- yr2s[s]
    row <- cat_info[!is.na(cat_info$y) & cat_info$y == yr, ]
    if (nrow(row) == 0) next
    tab <- tryCatch(dbReadTable(con, row$f[1]), error = function(e) NULL)
    if (is.null(tab) || !(exposure_var %in% names(tab))) next
    sub <- tab[, c(id_col, exposure_var)]
    sub$cycle <- s
    edat <- rbind(edat, sub)
  }
} else {
  tab <- tryCatch(dbReadTable(con, cat_info$f[1]), error = function(e) NULL)
  if (!is.null(tab) && exposure_var %in% names(tab) && id_col %in% names(tab)) {
    edat <- tab[, c(id_col, exposure_var)]
  }
}
if (is.null(edat) || nrow(edat) == 0) {
  cat(toJSON(list(error = paste0("no exposure data for '", exposure_var, "'")), auto_unbox = TRUE)); quit(status = 1)
}

merge_keys <- if (has_cycle && "cycle" %in% names(edat)) c(id_col, "cycle") else id_col
m <- merge(base, edat, by = merge_keys, all.x = FALSE)
m <- m[!is.na(m[[outcome_name]]) & !is.na(m[[exposure_var]]), ]
if (nrow(m) < 50) {
  cat(toJSON(list(error = paste0("only ", nrow(m), " complete cases")), auto_unbox = TRUE)); quit(status = 1)
}

# ─── Detect transform on exposure ───
ev <- m[[exposure_var]]
n_unique <- length(unique(ev))
is_cat_expo <- n_unique <= 5 && all(ev %% 1 == 0)

if (is_cat_expo) {
  m$x_t <- as.numeric(ev)
  x_transform <- "none"
  x_label <- exposure_var
} else {
  pos <- ev[ev > 0]
  eps <- if (length(pos) > 0) min(pos) / 2 else 1e-6
  m$x_t <- log10(pmax(ev, 0) + eps)
  x_transform <- "log10"
  x_label <- paste0("log10(", exposure_var, ")")
}

y_label <- outcome_name
is_binary <- phenotype_type == "binary"

# ─── Covariate handling ───
# Filter adjust_for to columns actually present on the merged frame.
adj_present <- if (!is.null(adjust_for)) intersect(adjust_for, names(m)) else character(0)
adj_skipped <- if (!is.null(adjust_for)) setdiff(adjust_for, adj_present) else character(0)
adjusted <- length(adj_present) > 0

# Coerce known categorical covariates to factors so lm/glm handle them correctly.
KNOWN_CATEGORICAL <- c("RIAGENDR","RIDRETH3","RIDRETH1","DMDEDUC2","DMDEDUC3","DMDMARTL")
for (cv in intersect(adj_present, KNOWN_CATEGORICAL)) {
  m[[cv]] <- as.factor(m[[cv]])
}

# Drop rows with missing covariates (otherwise lm/glm complete-cases inside the
# fit and we'd misalign indices when computing residuals).
if (adjusted) {
  for (cv in adj_present) m <- m[!is.na(m[[cv]]), ]
}
if (nrow(m) < 50) {
  cat(toJSON(list(error = paste0("only ", nrow(m), " complete cases after covariate filtering"),
                  adjusted_for = adj_present), auto_unbox = TRUE)); quit(status = 1)
}

# Sort by x for plotting consistency
m <- m[order(m$x_t), ]

# Subsample for raw points (visual budget)
n_total <- nrow(m)
n_sampled <- min(n_total, n_points_max)
samp_idx <- if (n_total > n_points_max) sort(sample.int(n_total, n_points_max)) else seq_len(n_total)

points_df <- data.frame(
  x = round(m$x_t[samp_idx], 6),
  y = m[[outcome_name]][samp_idx]
)
# For binary, jitter y slightly so 0/1 doesn't fully overplot
if (is_binary) points_df$y <- points_df$y + runif(nrow(points_df), -0.04, 0.04)
points_df$y <- round(points_df$y, 6)

# ─── Fit smoother ───
x_grid <- seq(quantile(m$x_t, 0.02, na.rm = TRUE), quantile(m$x_t, 0.98, na.rm = TRUE), length.out = n_grid)

fit_block <- list()
binned_block <- NULL

if (is_binary) {
  # Logistic fit, optionally with covariates. When adjusted, prediction holds
  # covariates at their representative value (factors -> mode, numerics -> median)
  # so the curve shows the marginal dose-response.
  glm_dat <- data.frame(y = as.numeric(m[[outcome_name]]), x_t = m$x_t)
  rep_cov <- list()
  if (adjusted) {
    for (cv in adj_present) {
      v <- m[[cv]]
      glm_dat[[cv]] <- v
      if (is.factor(v)) {
        rep_cov[[cv]] <- factor(names(sort(table(v), decreasing = TRUE))[1], levels = levels(v))
      } else {
        rep_cov[[cv]] <- median(as.numeric(v), na.rm = TRUE)
      }
    }
  }
  rhs <- if (adjusted) paste0("x_t + ", paste(adj_present, collapse = " + ")) else "x_t"
  fml <- as.formula(paste0("y ~ ", rhs))
  fit <- tryCatch(glm(fml, data = glm_dat, family = binomial()), error = function(e) NULL)
  if (!is.null(fit)) {
    newd <- data.frame(x_t = x_grid)
    if (adjusted) for (cv in adj_present) newd[[cv]] <- rep_cov[[cv]]
    pred <- predict(fit, newdata = newd, type = "link", se.fit = TRUE)
    invlogit <- function(z) 1 / (1 + exp(-z))
    fit_block <- list(
      method = if (adjusted) "logistic_adjusted" else "logistic",
      x_grid = round(x_grid, 6),
      y = round(invlogit(pred$fit), 6),
      ci_lower = round(invlogit(pred$fit - 1.96 * pred$se.fit), 6),
      ci_upper = round(invlogit(pred$fit + 1.96 * pred$se.fit), 6),
      reference = if (adjusted) lapply(rep_cov, function(v) if (is.factor(v)) as.character(v) else as.numeric(v)) else NULL
    )
  }
  # Decile bins (empirical probability with binomial CI)
  qs <- quantile(m$x_t, probs = seq(0, 1, length.out = 11), na.rm = TRUE)
  qs[1] <- qs[1] - 1e-9
  m$bin <- cut(m$x_t, breaks = qs, include.lowest = TRUE, labels = FALSE)
  binned <- m %>%
    group_by(bin) %>%
    summarise(
      x_mid = mean(x_t, na.rm = TRUE),
      n = n(),
      n_cases = sum(.data[[outcome_name]] == 1, na.rm = TRUE),
      .groups = "drop"
    ) %>%
    mutate(
      p = n_cases / pmax(1, n),
      se = sqrt(p * (1 - p) / pmax(1, n)),
      ci_lower = pmax(0, p - 1.96 * se),
      ci_upper = pmin(1, p + 1.96 * se),
    )
  binned_block <- lapply(seq_len(nrow(binned)), function(i) list(
    decile = as.integer(binned$bin[i]),
    x_mid = round(binned$x_mid[i], 6),
    n = as.integer(binned$n[i]),
    n_cases = as.integer(binned$n_cases[i]),
    p = round(binned$p[i], 6),
    se = round(binned$se[i], 6),
    ci_lower = round(binned$ci_lower[i], 6),
    ci_upper = round(binned$ci_upper[i], 6)
  ))
  y_label <- paste0("P(", outcome_name, " = 1)")
} else {
  # Continuous: LOESS smoother. With covariates, residualize y on covariates
  # first (Frisch-Waugh-Lovell style) so the smoother shows the dose-response
  # net of those covariates.
  y_for_fit <- as.numeric(m[[outcome_name]])
  if (adjusted) {
    cov_dat <- m[, adj_present, drop = FALSE]
    cov_dat$.y <- y_for_fit
    lm_fml <- as.formula(paste0(".y ~ ", paste(adj_present, collapse = " + ")))
    lm_fit <- tryCatch(lm(lm_fml, data = cov_dat), error = function(e) NULL)
    if (!is.null(lm_fit)) {
      y_for_fit <- as.numeric(residuals(lm_fit))
      # Also residualize points_df$y so the scatter matches the smoother
      points_df$y <- round(y_for_fit[samp_idx], 6)
      y_label <- paste0(outcome_name, " | residual after ", paste(adj_present, collapse = "+"))
    } else {
      adjusted <- FALSE  # adjustment failed, fall back to raw
    }
  }

  loess_dat <- data.frame(y = y_for_fit, x_t = m$x_t)
  span <- if (nrow(loess_dat) > 5000) 0.5 else if (nrow(loess_dat) > 1000) 0.65 else 0.8
  fit <- tryCatch(loess(y ~ x_t, data = loess_dat, span = span, degree = 2,
                        control = loess.control(surface = "direct")),
                  error = function(e) NULL)
  if (!is.null(fit)) {
    pred <- predict(fit, newdata = data.frame(x_t = x_grid), se = TRUE)
    fit_block <- list(
      method = if (adjusted) "loess_adjusted" else "loess",
      span = span,
      x_grid = round(x_grid, 6),
      y = round(as.numeric(pred$fit), 6),
      ci_lower = round(as.numeric(pred$fit - 1.96 * pred$se.fit), 6),
      ci_upper = round(as.numeric(pred$fit + 1.96 * pred$se.fit), 6)
    )
  }
}

# Simple summary stats
spearman_rho <- tryCatch(
  suppressWarnings(cor(m$x_t, as.numeric(m[[outcome_name]]), method = "spearman", use = "complete.obs")),
  error = function(e) NA_real_
)

output <- list(
  outcome = outcome_name,
  exposure = exposure_var,
  phenotype_type = phenotype_type,
  n_total = as.integer(n_total),
  n_sampled = as.integer(n_sampled),
  cycles_used = cycles_used,
  exposure_transform = x_transform,
  adjusted = adjusted,
  adjusted_for = if (adjusted) adj_present else NULL,
  adjust_for_skipped = if (length(adj_skipped) > 0) adj_skipped else NULL,
  x_label = x_label,
  y_label = y_label,
  points = lapply(seq_len(nrow(points_df)), function(i) list(x = points_df$x[i], y = points_df$y[i])),
  fit = if (length(fit_block) > 0) fit_block else NULL,
  binned = binned_block,
  summary = list(
    spearman_rho = round(spearman_rho, 4),
    n_cases = if (is_binary) as.integer(sum(m[[outcome_name]] == 1, na.rm = TRUE)) else NULL,
    weighted_outcome_mean = if (!is_binary && "wt_pooled" %in% names(m)) {
      ok <- !is.na(m$wt_pooled) & m$wt_pooled > 0
      round(sum(m[[outcome_name]][ok] * m$wt_pooled[ok]) / sum(m$wt_pooled[ok]), 4)
    } else NULL
  ),
  note = paste0("Continuous exposures are log10-transformed. ",
                if (is_binary) "Binary outcome: decile-binned empirical probabilities with binomial 95% CI + logistic-fit predicted probability curve. "
                else "Continuous outcome: subsampled raw points + LOESS line with 95% CI ribbon. ",
                "Subsample size capped to keep payload small.")
)

try(dbDisconnect(con), silent = TRUE)
cat(toJSON(output, auto_unbox = TRUE, null = "null"))
