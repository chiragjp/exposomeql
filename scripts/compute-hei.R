#!/usr/bin/env Rscript
# Compute Healthy Eating Index (HEI-2015) scores for NHANES participants
# Uses the `hei` R package to download FPED data and compute per-person scores
# Outputs CSV with SEQN (participant ID) and HEI total + component scores

library(hei)
library(jsonlite)

# Compute for recent cycles
cycles <- c("2015-2016", "2017-2018")

all_scores <- data.frame()

for (cycle in cycles) {
  cat("Computing HEI for", cycle, "...\n")

  tryCatch({
    # Get FPED, dietary, and demographic data
    fped <- get_fped(cycle)
    diet <- get_diet(cycle)
    demo <- get_demo(cycle)

    # Compute HEI-2015 scores
    scores <- hei(fped, diet, demo)

    cat("  Computed", nrow(scores), "scores\n")
    cat("  Mean HEI total:", round(mean(scores$HEI, na.rm=TRUE), 1), "\n")
    cat("  SD:", round(sd(scores$HEI, na.rm=TRUE), 1), "\n")

    scores$cycle <- cycle
    all_scores <- rbind(all_scores, scores)

  }, error = function(e) {
    cat("  ERROR:", e$message, "\n")
  })
}

if (nrow(all_scores) > 0) {
  # Save to CSV
  output_path <- "data/hei_scores.csv"
  write.csv(all_scores, output_path, row.names = FALSE)
  cat("\nSaved", nrow(all_scores), "HEI scores to", output_path, "\n")

  # Summary
  cat("\nSummary:\n")
  cat("  Total participants:", nrow(all_scores), "\n")
  cat("  Cycles:", paste(unique(all_scores$cycle), collapse=", "), "\n")
  cat("  HEI mean:", round(mean(all_scores$HEI, na.rm=TRUE), 1), "\n")
  cat("  HEI median:", round(median(all_scores$HEI, na.rm=TRUE), 1), "\n")
  cat("  HEI SD:", round(sd(all_scores$HEI, na.rm=TRUE), 1), "\n")
  cat("  HEI range:", round(min(all_scores$HEI, na.rm=TRUE), 1), "-",
      round(max(all_scores$HEI, na.rm=TRUE), 1), "\n")

  # Column names
  cat("\nColumns:", paste(names(all_scores), collapse=", "), "\n")
} else {
  cat("No scores computed.\n")
}
