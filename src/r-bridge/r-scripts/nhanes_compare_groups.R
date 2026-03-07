#!/usr/bin/env Rscript
# Survey-weighted group comparison for ExposomeQL
# Auto-selects t-test (2 groups) or design-adjusted ANOVA (>2 groups)

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

variable <- params$variable
group_var <- params$group_var
cycles <- params$cycles
subgroup <- params$subgroup

con <- connect_pewas_data(db_path)
on.exit(disconnect_pewas_data(con), add = TRUE)

if (is.null(cycles)) {
  tab_info <- get_table_names_for_varname(con, variable)
  yr2s <- c("1999"="A","2001"="B","2003"="C","2005"="D","2007"="E","2009"="F","2011"="G","2013"="H","2015"="I","2017"="J")
  cycles <- tail(sort(unique(yr2s[as.character(tab_info$Begin.Year)])), 1)
}

tryCatch({
  all_data <- NULL
  for (s in cycles) {
    tab_obj <- tryCatch(get_tables(variable, variable, s, con), error = function(e) NULL)
    if (is.null(tab_obj)) next
    tab_obj <- tryCatch(figure_out_weight(tab_obj), error = function(e) {
      tab_obj$merged_tab$wt <- tab_obj$merged_tab$WTMEC2YR
      if (is.null(tab_obj$merged_tab$wt) || all(is.na(tab_obj$merged_tab$wt))) {
        tab_obj$merged_tab$wt <- tab_obj$merged_tab$WTINT2YR
      }
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

  dat <- all_data %>% filter(!is.na(wt), wt > 0, !is.na(.data[[variable]]), !is.na(.data[[group_var]]))
  if (!is.null(subgroup) && nzchar(subgroup)) {
    dat <- dat %>% filter(eval(parse(text = subgroup)))
  }

  n_cycles <- length(cycles)
  if (n_cycles > 1) dat$wt <- dat$wt / n_cycles

  dat[[group_var]] <- as.factor(dat[[group_var]])
  n_groups <- nlevels(dat[[group_var]])

  if (n_groups < 2) {
    cat(toJSON(list(error = paste0("Group variable '", group_var, "' has only ", n_groups, " level(s) after filtering. Need at least 2 groups for comparison.")), auto_unbox = TRUE))
    quit(status = 0)
  }

  options(survey.lonely.psu = "adjust")
  dsn <- svydesign(ids = ~SDMVPSU, strata = ~SDMVSTRA, weights = ~wt, nest = TRUE, data = dat)

  # Group-level means
  outcome_form <- as.formula(paste0("~", variable))
  by_form <- as.formula(paste0("~", group_var))
  group_means <- svyby(outcome_form, by_form, dsn, svymean, na.rm = TRUE, vartype = c("se", "ci"))
  group_means_df <- as.data.frame(group_means)

  # Group Ns
  group_n <- dat %>%
    group_by(.data[[group_var]]) %>%
    summarise(n = n(), .groups = "drop")

  test_result <- NULL

  if (n_groups == 2) {
    # Survey-weighted t-test
    levels_g <- levels(dat[[group_var]])
    form_t <- as.formula(paste0(variable, " ~ ", group_var))
    ttest <- svyttest(form_t, dsn)

    test_result <- list(
      method = "Survey-weighted t-test (svyttest)",
      statistic = round(as.numeric(ttest$statistic), 4),
      df = round(as.numeric(ttest$parameter), 2),
      p_value = ttest$p.value,
      difference = round(as.numeric(ttest$estimate), 6),
      ci_lower = round(as.numeric(ttest$conf.int[1]), 6),
      ci_upper = round(as.numeric(ttest$conf.int[2]), 6),
      groups_compared = levels_g
    )
  } else {
    # Design-adjusted ANOVA via regTermTest
    model_form <- as.formula(paste0(variable, " ~ ", group_var))
    fit <- svyglm(model_form, design = dsn)
    anova_result <- regTermTest(fit, group_var)

    test_result <- list(
      method = "Design-adjusted Wald test (regTermTest)",
      f_statistic = round(as.numeric(anova_result$Ftest), 4),
      df_num = anova_result$df,
      df_denom = anova_result$ddf,
      p_value = anova_result$p,
      n_groups = n_groups
    )
  }

  output <- list(
    variable = variable,
    group_var = group_var,
    n_groups = n_groups,
    group_means = group_means_df,
    group_n = as.data.frame(group_n),
    test = test_result,
    n_total = nrow(dat),
    cycles_used = cycles
  )

  cat(toJSON(output, auto_unbox = TRUE, null = "null"))

}, error = function(e) {
  cat(toJSON(list(error = conditionMessage(e)), auto_unbox = TRUE))
  quit(status = 1)
})
