#!/usr/bin/env Rscript
# Survey-weighted mean computation for ExposomeQL
# Reads JSON params from stdin, writes JSON result to stdout

suppressPackageStartupMessages({
  library(jsonlite)
  library(survey)
  library(DBI)
  library(RSQLite)
  library(dplyr)
})

# Load nhanespewas if available
nhanespewas_path <- Sys.getenv("NHANESPEWAS_PATH")
if (!isNamespaceLoaded("nhanespewas")) {
  if (nzchar(nhanespewas_path) && file.exists(file.path(nhanespewas_path, "DESCRIPTION")) && requireNamespace("devtools", quietly = TRUE)) {
    suppressPackageStartupMessages(devtools::load_all(nhanespewas_path, quiet = TRUE))
  } else {
    suppressPackageStartupMessages(library(nhanespewas))
  }
}

# Read params from stdin
params <- if (exists("POOL_PARAMS", envir = globalenv())) get("POOL_PARAMS", envir = globalenv()) else fromJSON(file("stdin"))
db_path <- Sys.getenv("EXPOSOMEQL_DB_PATH")

variable <- params$variable
cycles <- params$cycles      # character vector of series letters, or NULL
subgroup <- params$subgroup   # R expression string for filtering, or NULL

# Connect to database
con <- connect_pewas_data(db_path)
# on.exit removed for pool compatibility; cleanup handled in tryCatch finally

# If no cycles specified, use the most recent available
if (is.null(cycles)) {
  # Find which cycles have this variable
  tab_info <- get_table_names_for_varname(con, variable)
  if (nrow(tab_info) == 0) {
    cat(toJSON(list(error = paste0("Variable ", variable, " not found in any NHANES cycle")), auto_unbox = TRUE))
    quit(status = 0)
  }
  # Use the most recent cycle
  yr2s <- c("1999"="A","2001"="B","2003"="C","2005"="D","2007"="E","2009"="F","2011"="G","2013"="H","2015"="I","2017"="J")
  cycles <- tail(sort(unique(yr2s[as.character(tab_info$Begin.Year)])), 1)
}

# Survey design variables
survey_vars <- c("SDMVPSU", "SDMVSTRA", "WTMEC2YR", "WTMEC4YR", "SDDSRVYR")

tryCatch({
  # Get merged data across cycles
  all_data <- NULL
  for (s in cycles) {
    tab_obj <- tryCatch(
      get_tables(variable, variable, s, con),
      error = function(e) NULL
    )
    if (is.null(tab_obj)) next
    tab_obj <- figure_out_weight(tab_obj)
    if (!is.null(tab_obj$merged_tab) && nrow(tab_obj$merged_tab) > 0) {
      dat <- tab_obj$merged_tab
      if (is.null(all_data)) {
        all_data <- dat
      } else {
        # Align columns for rbind
        common_cols <- intersect(names(all_data), names(dat))
        all_data <- rbind(all_data[, common_cols], dat[, common_cols])
      }
    }
  }

  if (is.null(all_data) || nrow(all_data) == 0) {
    cat(toJSON(list(error = "No data found for specified variable and cycles"), auto_unbox = TRUE))
    quit(status = 0)
  }

  # Filter to valid weights and non-missing outcome
  dat <- all_data %>%
    filter(!is.na(wt), wt > 0, !is.na(.data[[variable]]))

  # Apply subgroup filter if specified
  if (!is.null(subgroup) && nzchar(subgroup)) {
    dat <- dat %>% filter(eval(parse(text = subgroup)))
  }

  # Adjust weights for multi-cycle pooling
  n_cycles <- length(cycles)
  if (n_cycles > 1) {
    # Check for A+B 4-year weight case
    if (n_cycles == 2 && all(c("A", "B") %in% cycles) && "WTMEC4YR" %in% names(dat)) {
      dat$wt <- dat$WTMEC4YR
    } else {
      dat$wt <- dat$wt / n_cycles
    }
  }

  # Create survey design
  options(survey.lonely.psu = "adjust")
  dsn <- svydesign(
    ids = ~SDMVPSU,
    strata = ~SDMVSTRA,
    weights = ~wt,
    nest = TRUE,
    data = dat
  )

  # Compute survey-weighted mean
  form <- as.formula(paste0("~", variable))
  result <- svymean(form, design = dsn, na.rm = TRUE)
  ci <- confint(result)

  # Compute geometric mean for biomarkers
  geometric_mean <- NULL
  if (grepl("^(LBX|URX)", variable)) {
    pos_vals <- dat[[variable]][dat[[variable]] > 0]
    if (length(pos_vals) > 0) {
      log_form <- as.formula(paste0("~log(", variable, ")"))
      # Only compute geometric mean if all values are positive
      dat_pos <- dat %>% filter(.data[[variable]] > 0)
      if (nrow(dat_pos) > 0) {
        dsn_pos <- svydesign(
          ids = ~SDMVPSU, strata = ~SDMVSTRA,
          weights = ~wt, nest = TRUE, data = dat_pos
        )
        log_mean <- tryCatch(
          coef(svymean(log_form, design = dsn_pos, na.rm = TRUE)),
          error = function(e) NA
        )
        if (!is.na(log_mean)) {
          geometric_mean <- exp(log_mean)
        }
      }
    }
  }

  # Check LOD (for lab variables with comment codes)
  pct_below_lod <- NULL
  comment_col <- NULL
  if (grepl("^LBX", variable)) {
    comment_col <- paste0("LBD", substring(variable, 4), "LC")
  } else if (grepl("^URX", variable)) {
    comment_col <- paste0("URD", substring(variable, 4), "LC")
  }
  if (!is.null(comment_col) && comment_col %in% names(dat)) {
    n_below <- sum(dat[[comment_col]] == 1, na.rm = TRUE)
    n_total <- sum(!is.na(dat[[comment_col]]))
    if (n_total > 0) {
      pct_below_lod <- round(100 * n_below / n_total, 1)
    }
  }

  # Determine which weight was used
  weight_used <- "WTMEC2YR"
  if (n_cycles == 2 && all(c("A", "B") %in% cycles)) {
    weight_used <- "WTMEC4YR"
  }

  # Build output
  output <- list(
    mean = round(as.numeric(coef(result)), 6),
    se = round(as.numeric(SE(result)), 6),
    ci_lower = round(as.numeric(ci[1, 1]), 6),
    ci_upper = round(as.numeric(ci[1, 2]), 6),
    geometric_mean = if (!is.null(geometric_mean)) round(geometric_mean, 6) else NULL,
    n_unweighted = nrow(dat),
    n_weighted = round(sum(dat$wt)),
    pct_below_lod = pct_below_lod,
    weight_used = weight_used,
    cycles_used = cycles,
    variable = variable
  )

  cat(toJSON(output, auto_unbox = TRUE, null = "null"))

}, error = function(e) {
  cat(toJSON(list(error = conditionMessage(e)), auto_unbox = TRUE))
  quit(status = 1)
}, finally = {
  try(disconnect_pewas_data(con), silent = TRUE)
})
