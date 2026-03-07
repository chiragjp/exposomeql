#!/usr/bin/env Rscript
# Survey-weighted cross-tabulation with Rao-Scott chi-square for ExposomeQL

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

var1 <- params$var1
var2 <- params$var2
cycles <- params$cycles
subgroup <- params$subgroup

con <- connect_pewas_data(db_path)
on.exit(disconnect_pewas_data(con), add = TRUE)

if (is.null(cycles)) {
  tab_info <- get_table_names_for_varname(con, var1)
  yr2s <- c("1999"="A","2001"="B","2003"="C","2005"="D","2007"="E","2009"="F","2011"="G","2013"="H","2015"="I","2017"="J")
  cycles <- tail(sort(unique(yr2s[as.character(tab_info$Begin.Year)])), 1)
}

tryCatch({
  all_data <- NULL
  for (s in cycles) {
    tab_obj <- tryCatch(get_tables(var1, var2, s, con), error = function(e) NULL)
    if (is.null(tab_obj)) next
    # figure_out_weight can fail for pure demographic variables; fall back to weight columns
    tab_obj <- tryCatch(figure_out_weight(tab_obj), error = function(e) {
      mt <- tab_obj$merged_tab
      # Handle .x/.y suffixed columns from self-joins
      wt_col <- if ("WTMEC2YR" %in% names(mt)) mt$WTMEC2YR
                else if ("WTMEC2YR.x" %in% names(mt)) mt$WTMEC2YR.x
                else if ("WTINT2YR" %in% names(mt)) mt$WTINT2YR
                else if ("WTINT2YR.x" %in% names(mt)) mt$WTINT2YR.x
                else NULL
      mt$wt <- wt_col
      # Fix .x/.y suffixed variable columns
      if (!var1 %in% names(mt) && paste0(var1, ".x") %in% names(mt)) mt[[var1]] <- mt[[paste0(var1, ".x")]]
      if (!var2 %in% names(mt) && paste0(var2, ".x") %in% names(mt)) mt[[var2]] <- mt[[paste0(var2, ".x")]]
      if (!"SDMVPSU" %in% names(mt) && "SDMVPSU.x" %in% names(mt)) mt$SDMVPSU <- mt$SDMVPSU.x
      if (!"SDMVSTRA" %in% names(mt) && "SDMVSTRA.x" %in% names(mt)) mt$SDMVSTRA <- mt$SDMVSTRA.x
      tab_obj$merged_tab <- mt
      tab_obj
    })
    dat <- tab_obj$merged_tab
    if (!is.null(dat) && nrow(dat) > 0) {
      if (is.null(all_data)) all_data <- dat
      else {
        common_cols <- intersect(names(all_data), names(dat))
        all_data <- rbind(all_data[, common_cols], dat[, common_cols])
      }
    }
  }

  if (is.null(all_data) || nrow(all_data) == 0) {
    cat(toJSON(list(error = "No data found"), auto_unbox = TRUE))
    quit(status = 0)
  }

  dat <- all_data %>% filter(!is.na(wt), wt > 0, !is.na(.data[[var1]]), !is.na(.data[[var2]]))
  if (!is.null(subgroup) && nzchar(subgroup)) {
    dat <- dat %>% filter(eval(parse(text = subgroup)))
  }

  n_cycles <- length(cycles)
  if (n_cycles > 1) dat$wt <- dat$wt / n_cycles

  # Convert to factors for cross-tabulation
  dat[[var1]] <- as.factor(dat[[var1]])
  dat[[var2]] <- as.factor(dat[[var2]])

  if (nlevels(dat[[var1]]) < 2) {
    cat(toJSON(list(error = paste0("Variable '", var1, "' has only ", nlevels(dat[[var1]]), " level(s). Cross-tabulation requires at least 2 levels per variable.")), auto_unbox = TRUE))
    quit(status = 0)
  }
  if (nlevels(dat[[var2]]) < 2) {
    cat(toJSON(list(error = paste0("Variable '", var2, "' has only ", nlevels(dat[[var2]]), " level(s). Cross-tabulation requires at least 2 levels per variable.")), auto_unbox = TRUE))
    quit(status = 0)
  }

  options(survey.lonely.psu = "adjust")
  dsn <- svydesign(ids = ~SDMVPSU, strata = ~SDMVSTRA, weights = ~wt, nest = TRUE, data = dat)

  # Cross-tabulation
  form <- as.formula(paste0("~", var1, "+", var2))
  tab <- svytable(form, dsn)

  # Rao-Scott chi-square test
  chi_test <- svychisq(form, dsn, statistic = "F")

  # Convert table to list format
  tab_df <- as.data.frame(tab)
  names(tab_df) <- c(var1, var2, "weighted_count")
  tab_df$weighted_count <- round(tab_df$weighted_count)

  # Row and column proportions
  row_props <- prop.table(tab, margin = 1)
  col_props <- prop.table(tab, margin = 2)

  row_df <- as.data.frame(row_props)
  names(row_df) <- c(var1, var2, "row_proportion")
  row_df$row_proportion <- round(row_df$row_proportion, 4)

  col_df <- as.data.frame(col_props)
  names(col_df) <- c(var1, var2, "col_proportion")
  col_df$col_proportion <- round(col_df$col_proportion, 4)

  # Merge
  merged <- merge(tab_df, row_df, by = c(var1, var2))
  merged <- merge(merged, col_df, by = c(var1, var2))

  output <- list(
    var1 = var1,
    var2 = var2,
    table = merged,
    test = list(
      statistic = round(as.numeric(chi_test$statistic), 4),
      p_value = chi_test$p.value,
      df_num = chi_test$parameter[1],
      df_denom = chi_test$parameter[2],
      method = "Rao-Scott F-adjusted chi-square"
    ),
    n_unweighted = nrow(dat),
    cycles_used = cycles
  )

  cat(toJSON(output, auto_unbox = TRUE, null = "null"))

}, error = function(e) {
  cat(toJSON(list(error = conditionMessage(e)), auto_unbox = TRUE))
  quit(status = 1)
})
