# Same preamble as nhanes_mean.R, but NO on.exit, NO isNamespaceLoaded guard
suppressPackageStartupMessages({
  library(jsonlite); library(survey); library(DBI); library(RSQLite); library(dplyr)
})
nhanespewas_path <- Sys.getenv("NHANESPEWAS_PATH")
if (!isNamespaceLoaded("nhanespewas")) suppressPackageStartupMessages(library(nhanespewas))

params <- if (exists("POOL_PARAMS", envir = globalenv())) get("POOL_PARAMS", envir = globalenv()) else fromJSON(file("stdin"))
db_path <- Sys.getenv("EXPOSOMEQL_DB_PATH")

con <- connect_pewas_data(db_path)
# NO on.exit — let the script return without cleanup
t <- tryCatch(get_table_names_for_varname(con, params$variable),
              error = function(e) { cat("ERROR:", conditionMessage(e), "\n", file=stderr()); NULL })
try(disconnect_pewas_data(con), silent=TRUE)
cat(jsonlite::toJSON(list(ok=!is.null(t), n_tables=if(!is.null(t)) nrow(t) else 0), auto_unbox=TRUE))
