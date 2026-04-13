#!/usr/bin/env Rscript
# Find NHANES "doppelgangers" — participants matching a demographic and exposure profile
# Returns empirical health outcome distributions for matched individuals

suppressPackageStartupMessages({
  library(jsonlite)
  library(DBI)
  library(RSQLite)
  library(survey)
})

# Read input from stdin
input <- fromJSON(readLines(con = "stdin", warn = FALSE))

db_path <- Sys.getenv("EXPOSOMEQL_DB_PATH",
  unset = file.path(Sys.getenv("EXPOSOMEQL_DATA_DIR", unset = "data"), "nhanes_031725.sqlite"))

con <- dbConnect(SQLite(), db_path)
on.exit(dbDisconnect(con))

# Get the most recent cycle's demo data
demo <- dbGetQuery(con, "SELECT SEQN, RIDAGEYR, RIAGENDR, RIDRETH3, BMXBMI, WTMEC2YR, SDMVPSU, SDMVSTRA FROM DEMO_J LEFT JOIN BMX_J USING(SEQN)")

# Demographic filtering
matched <- demo
matched <- matched[matched$RIDAGEYR >= input$age_min & matched$RIDAGEYR <= input$age_max, ]
matched <- matched[matched$RIAGENDR == input$sex_code, ]
if (!is.null(input$race_code)) {
  matched <- matched[matched$RIDRETH3 == input$race_code, ]
}
n_demographic <- nrow(matched)

# Exposure matching (if provided)
if (!is.null(input$exposure_filters) && length(input$exposure_filters) > 0) {
  window <- input$match_window

  for (ef in input$exposure_filters) {
    parts <- strsplit(ef, ":")[[1]]
    var_name <- parts[1]
    target_value <- as.numeric(parts[2])

    # Find which table has this variable
    tables <- dbListTables(con)
    found <- FALSE
    for (tbl in grep("_J$", tables, value = TRUE)) {
      tryCatch({
        cols <- dbListFields(con, tbl)
        if (var_name %in% cols) {
          exp_data <- dbGetQuery(con, sprintf("SELECT SEQN, \"%s\" FROM \"%s\" WHERE \"%s\" IS NOT NULL", var_name, tbl, var_name))
          matched <- merge(matched, exp_data, by = "SEQN")

          # Compute z-score and filter to window
          exp_vals <- matched[[var_name]]
          # Log-transform if positive (consistent with EP-WAS)
          if (all(exp_vals > 0, na.rm = TRUE)) {
            exp_vals <- log10(exp_vals)
            target_value <- log10(target_value)
          }
          z <- (exp_vals - mean(exp_vals, na.rm = TRUE)) / sd(exp_vals, na.rm = TRUE)
          target_z <- (target_value - mean(exp_vals, na.rm = TRUE)) / sd(exp_vals, na.rm = TRUE)
          matched <- matched[abs(z - target_z) <= window, ]
          found <- TRUE
          break
        }
      }, error = function(e) {})
    }
  }
}

n_matched <- nrow(matched)

# Get phenotype distributions for matched individuals
phenotype_distributions <- list()
if (n_matched >= 10) {
  for (pvar in input$phenotypes) {
    # Find in cycle J tables
    tables <- dbListTables(con)
    for (tbl in grep("_J$", tables, value = TRUE)) {
      tryCatch({
        cols <- dbListFields(con, tbl)
        if (pvar %in% cols) {
          pdata <- dbGetQuery(con, sprintf("SELECT SEQN, \"%s\" FROM \"%s\" WHERE \"%s\" IS NOT NULL", pvar, tbl, pvar))
          pmerged <- merge(matched, pdata, by = "SEQN")
          vals <- pmerged[[pvar]]
          vals <- vals[!is.na(vals)]

          if (length(vals) >= 10) {
            qs <- quantile(vals, probs = c(0.05, 0.25, 0.50, 0.75, 0.95), na.rm = TRUE)
            phenotype_distributions[[length(phenotype_distributions) + 1]] <- list(
              variable = pvar,
              n = length(vals),
              mean = round(mean(vals), 2),
              sd = round(sd(vals), 2),
              p5 = round(qs[1], 2),
              p25 = round(qs[2], 2),
              median = round(qs[3], 2),
              p75 = round(qs[4], 2),
              p95 = round(qs[5], 2)
            )
          }
          break
        }
      }, error = function(e) {})
    }
  }
}

result <- list(
  n_demographic = n_demographic,
  n_matched = n_matched,
  phenotype_distributions = phenotype_distributions
)

cat(toJSON(result, auto_unbox = TRUE))
