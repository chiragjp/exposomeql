#!/usr/bin/env Rscript
# Survey-weighted conditional mean for ExposomeQL
# Computes mean(outcome) at each bin of a conditioning variable

suppressPackageStartupMessages({
  library(jsonlite)
  library(survey)
  library(DBI)
  library(RSQLite)
  library(dplyr)
})

nhanespewas_path <- Sys.getenv("NHANESPEWAS_PATH")
if (nzchar(nhanespewas_path) && file.exists(file.path(nhanespewas_path, "DESCRIPTION"))) {
  suppressPackageStartupMessages(devtools::load_all(nhanespewas_path, quiet = TRUE))
} else {
  suppressPackageStartupMessages(library(nhanespewas))
}

params <- fromJSON(file("stdin"))
db_path <- Sys.getenv("EXPOSOMEQL_DB_PATH")

outcome_var <- params$outcome
given_var <- params$given
n_bins <- ifelse(is.null(params$bins), 10, params$bins)
cycles <- params$cycles
subgroup <- params$subgroup

con <- connect_pewas_data(db_path)
on.exit(disconnect_pewas_data(con), add = TRUE)

# If no cycles specified, use most recent
if (is.null(cycles)) {
  tab_info_o <- get_table_names_for_varname(con, outcome_var)
  cycles <- tail(sort(unique(tab_info_o$series)), 1)
}

tryCatch({
  all_data <- NULL
  for (s in cycles) {
    tab_obj <- tryCatch(
      get_tables(outcome_var, outcome_var, s, con),
      error = function(e) NULL
    )
    if (is.null(tab_obj)) next
    tab_obj <- figure_out_weight(tab_obj)
    dat <- tab_obj$merged_tab

    # The given variable might be in the merged table (DEMO variables are auto-merged)
    # If not, fetch it separately
    if (!(given_var %in% names(dat))) {
      tab_obj_g <- tryCatch(
        get_tables(given_var, given_var, s, con),
        error = function(e) NULL
      )
      if (!is.null(tab_obj_g) && !is.null(tab_obj_g$merged_tab)) {
        given_dat <- tab_obj_g$merged_tab %>% select(SEQN, all_of(given_var))
        dat <- dat %>% left_join(given_dat, by = "SEQN")
      }
    }

    if (!is.null(dat) && nrow(dat) > 0) {
      if (is.null(all_data)) {
        all_data <- dat
      } else {
        common_cols <- intersect(names(all_data), names(dat))
        all_data <- rbind(all_data[, common_cols], dat[, common_cols])
      }
    }
  }

  if (is.null(all_data) || nrow(all_data) == 0) {
    cat(toJSON(list(error = "No data found"), auto_unbox = TRUE))
    quit(status = 0)
  }

  # Filter
  dat <- all_data %>%
    filter(!is.na(wt), wt > 0,
           !is.na(.data[[outcome_var]]),
           !is.na(.data[[given_var]]))

  if (!is.null(subgroup) && nzchar(subgroup)) {
    dat <- dat %>% filter(eval(parse(text = subgroup)))
  }

  # Adjust weights for multi-cycle
  n_cycles_used <- length(cycles)
  if (n_cycles_used > 1) {
    dat$wt <- dat$wt / n_cycles_used
  }

  # Determine if conditioning variable is continuous or categorical
  n_unique <- length(unique(dat[[given_var]]))
  is_continuous <- n_unique > n_bins

  if (is_continuous) {
    # Check for constant conditioning variable
    given_min <- min(dat[[given_var]], na.rm = TRUE)
    given_max <- max(dat[[given_var]], na.rm = TRUE)
    if (given_min == given_max) {
      cat(toJSON(list(error = paste0("Conditioning variable '", given_var, "' is constant (all values = ", given_min, "). Cannot create bins.")), auto_unbox = TRUE))
      quit(status = 0)
    }

    # Use weighted quantiles to create bins
    breaks <- wtd_quantile <- quantile(
      dat[[given_var]],
      probs = seq(0, 1, length.out = n_bins + 1),
      na.rm = TRUE
    )
    breaks <- unique(as.numeric(breaks))
    if (length(breaks) < 3) {
      breaks <- seq(given_min, given_max, length.out = n_bins + 1)
      breaks <- unique(breaks)
      if (length(breaks) < 2) {
        cat(toJSON(list(error = paste0("Cannot create bins for '", given_var, "': insufficient distinct break points.")), auto_unbox = TRUE))
        quit(status = 0)
      }
    }
    dat$bin <- cut(dat[[given_var]], breaks = breaks, include.lowest = TRUE)
  } else {
    dat$bin <- as.factor(dat[[given_var]])
  }

  # Remove rows where bin is NA
  dat <- dat %>% filter(!is.na(bin))

  # Create survey design
  options(survey.lonely.psu = "adjust")
  dsn <- svydesign(
    ids = ~SDMVPSU, strata = ~SDMVSTRA,
    weights = ~wt, nest = TRUE, data = dat
  )

  # Compute conditional means
  form <- as.formula(paste0("~", outcome_var))
  result <- svyby(form, ~bin, dsn, svymean, na.rm = TRUE, keep.names = FALSE)

  # Build output table
  se_col <- paste0("se.", outcome_var)
  if (!(se_col %in% names(result))) {
    se_col <- grep("^se", names(result), value = TRUE)[1]
  }

  output_table <- data.frame(
    bin = as.character(result$bin),
    mean = round(as.numeric(result[[outcome_var]]), 4),
    se = round(as.numeric(result[[se_col]]), 4),
    stringsAsFactors = FALSE
  )

  # Add bin midpoints for plotting (continuous case)
  if (is_continuous) {
    output_table$bin_midpoint <- sapply(output_table$bin, function(b) {
      nums <- as.numeric(regmatches(b, gregexpr("[0-9.e+-]+", b))[[1]])
      if (length(nums) >= 2) mean(nums) else NA
    })
  }

  # Cell size per bin
  bin_counts <- dat %>% group_by(bin) %>% summarise(n = n(), .groups = "drop")
  output_table <- output_table %>%
    left_join(bin_counts %>% mutate(bin = as.character(bin)), by = "bin")

  # Warnings
  warnings_list <- character(0)
  small_bins <- output_table$n[!is.na(output_table$n) & output_table$n < 30]
  if (length(small_bins) > 0) {
    warnings_list <- c(warnings_list, paste0(length(small_bins),
                                    " bin(s) have N < 30. Estimates may be unreliable."))
  }

  output <- list(
    outcome = outcome_var,
    given = given_var,
    n_bins = nrow(output_table),
    is_continuous = is_continuous,
    table = output_table,
    n_total = nrow(dat),
    cycles_used = cycles,
    warnings = warnings_list
  )

  cat(toJSON(output, auto_unbox = TRUE, null = "null"))

}, error = function(e) {
  cat(toJSON(list(error = conditionMessage(e)), auto_unbox = TRUE))
  quit(status = 1)
})
