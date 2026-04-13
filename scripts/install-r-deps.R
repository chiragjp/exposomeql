#!/usr/bin/env Rscript
# ExposomeQL — R dependency installer
# Run once after `npm install`: `npm run setup-r`

cran_pkgs <- c(
  "survey", "dplyr", "tidyr", "purrr", "broom", "stringr",
  "jsonlite", "DBI", "RSQLite", "mgcv", "rms", "mediation", "quantreg"
)

github_pkgs <- list(
  nhanespewas = "chiragjp/nhanespewas",
  hei         = "timfolsom/hei"
)

repo <- "https://cloud.r-project.org"

missing_cran <- cran_pkgs[!vapply(cran_pkgs, requireNamespace, logical(1), quietly = TRUE)]
if (length(missing_cran)) {
  cat("[setup-r] Installing CRAN packages:", paste(missing_cran, collapse = ", "), "\n")
  install.packages(missing_cran, repos = repo)
} else {
  cat("[setup-r] All CRAN packages already installed\n")
}

if (!requireNamespace("remotes", quietly = TRUE)) {
  cat("[setup-r] Installing remotes (needed for GitHub packages)\n")
  install.packages("remotes", repos = repo)
}

for (pkg in names(github_pkgs)) {
  if (!requireNamespace(pkg, quietly = TRUE)) {
    cat("[setup-r] Installing", pkg, "from", github_pkgs[[pkg]], "\n")
    remotes::install_github(github_pkgs[[pkg]], upgrade = "never")
  } else {
    cat("[setup-r]", pkg, "already installed\n")
  }
}

all_pkgs <- c(cran_pkgs, names(github_pkgs))
still_missing <- all_pkgs[!vapply(all_pkgs, requireNamespace, logical(1), quietly = TRUE)]
if (length(still_missing)) {
  cat("[setup-r] ERROR: failed to install:", paste(still_missing, collapse = ", "), "\n")
  quit(status = 1)
}
cat("[setup-r] Done. All", length(all_pkgs), "R packages ready.\n")
