#!/usr/bin/env Rscript
# ExposomeQL R worker harness for the persistent pool.
#
# Pre-loads every package the R-backed tools need, then runs a command loop
# reading line-delimited JSON from stdin. Each command picks an existing
# r-script, sources it with `POOL_PARAMS` injected (the script must be patched
# to read POOL_PARAMS first, falling back to file("stdin") in one-shot mode),
# captures stdout, and emits a delimited JSON response.
#
# Protocol (over stdin/stdout):
#   parent → worker (one JSON object per line):
#     {"id":"<uuid>","script":"/abs/path.R","params":{...},"env":{"K":"V",...}}
#   worker → parent (between the two delimiter lines):
#     __POOL_BEGIN__<id>
#     {"id":"<uuid>","ok":true|false,"result":"<captured stdout>","error":"..."}
#     __POOL_END__
#
# A startup readiness signal is emitted with id="ready" once libraries are loaded.

suppressPackageStartupMessages({
  library(jsonlite)
  library(survey)
  library(DBI)
  library(RSQLite)
  library(dplyr)
  library(tidyr)
  library(purrr)
  library(broom)
  library(stringr)
})

# Pre-load nhanespewas (the heavy package); prefer dev source if NHANESPEWAS_PATH
# points to a working tree, else use the installed namespace.
.preload_nhanespewas <- function() {
  pth <- Sys.getenv("NHANESPEWAS_PATH")
  if (nzchar(pth) && file.exists(file.path(pth, "DESCRIPTION"))) {
    if (requireNamespace("devtools", quietly = TRUE)) {
      suppressPackageStartupMessages(devtools::load_all(pth, quiet = TRUE))
      return(invisible())
    }
  }
  if (requireNamespace("nhanespewas", quietly = TRUE)) {
    suppressPackageStartupMessages(library(nhanespewas))
  }
}
.preload_nhanespewas()

BEGIN_MARK <- "__POOL_BEGIN__"
END_MARK   <- "__POOL_END__"

emit_response <- function(id, ok, result_text = "", error = NA_character_) {
  cat(BEGIN_MARK, id, "\n", sep = "")
  cat(toJSON(
    list(id = id, ok = ok, result = result_text, error = error),
    auto_unbox = TRUE, null = "null", na = "null"
  ))
  cat("\n", END_MARK, "\n", sep = "")
  flush(stdout())
}

# Make a fresh script environment that intercepts quit()/q() so an early-exit
# in a script doesn't kill the whole worker.
make_script_env <- function() {
  e <- new.env(parent = globalenv())
  intercept_quit <- function(save = "default", status = 0, runLast = TRUE) {
    cond <- structure(
      class = c("poolScriptExit", "condition"),
      list(message = "script exit", status = status)
    )
    stop(cond)
  }
  assign("quit", intercept_quit, envir = e)
  assign("q",    intercept_quit, envir = e)
  e
}

# Signal readiness so the parent can start dispatching work.
emit_response("ready", TRUE, "")

con <- file("stdin", "r", blocking = TRUE)

repeat {
  line <- readLines(con, n = 1, warn = FALSE)
  if (length(line) == 0) {
    # EOF — parent closed stdin, exit cleanly
    break
  }
  if (!nzchar(line)) next

  cmd <- tryCatch(
    fromJSON(line, simplifyVector = FALSE),
    error = function(e) NULL
  )
  if (is.null(cmd) || is.null(cmd$id) || is.null(cmd$script)) next

  # Reset env vars for this call (best-effort; non-string values are coerced).
  if (!is.null(cmd$env) && length(cmd$env) > 0) {
    string_env <- lapply(cmd$env, as.character)
    do.call(Sys.setenv, string_env)
  }

  # Inject params into globalenv so the script can find it.
  assign("POOL_PARAMS", cmd$params, envir = globalenv())

  status <- "ok"
  err <- NA_character_

  out <- tryCatch(
    paste(capture.output({
      tryCatch(
        sys.source(cmd$script, envir = make_script_env(), keep.source = FALSE),
        poolScriptExit = function(c) invisible(NULL)
      )
    }, type = "output"), collapse = "\n"),
    error = function(e) {
      status <<- "error"
      err <<- conditionMessage(e)
      ""
    }
  )

  if (exists("POOL_PARAMS", envir = globalenv())) {
    rm("POOL_PARAMS", envir = globalenv())
  }

  emit_response(cmd$id, status == "ok", out, err)
}
