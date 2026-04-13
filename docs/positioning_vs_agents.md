# ExposomeQL vs Existing AI Agents: How This MCP Server Stands Apart

## Core Positioning

ExposomeQL is a **primary data agent for environmental epidemiology** — the same way Stanford's Biomni is a primary data agent for molecular biology. Both analyze primary research data (not literature), but in complementary domains with domain-specific statistical methods. ExposomeQL brings proper epidemiological methods (survey weights, LOD handling, meta-analysis, confounding detection) to population health data — a capability no existing biomedical AI agent provides.

## The Current Landscape of Biomedical AI Agents (2025-2026)

A growing ecosystem of AI tools enables scientific literature synthesis and biomedical evidence retrieval:

| Tool | What It Does | Data Source | Output |
|------|-------------|-------------|--------|
| **Elicit** | Systematic review automation; structured data extraction from papers | Semantic Scholar, OpenAlex (200M+ papers) | Tables of extracted claims, study characteristics |
| **Consensus** | Answers research questions by measuring agreement across papers | Semantic Scholar (200M+ papers) | "Yes/No/Mixed" consensus meter, cited summaries |
| **Semantic Scholar** | Citation mapping, AI-generated summaries, paper discovery | 200M+ papers (Allen Institute for AI) | Paper lists, citation graphs, TLDR summaries |
| **BioMCP** | MCP server connecting AI agents to PubMed, ClinicalTrials.gov, MyVariant.info | 12 entities across 15+ sources | Markdown summaries of trials, genes, variants |
| **OpenEvidence** | Clinical question answering from medical literature | PubMed, clinical guidelines | Cited clinical answers |
| **Iris.ai** | Research mapping, concept extraction | Published literature | Knowledge maps, concept clusters |
| **Perplexity / ChatGPT** | General-purpose LLM search with citations | Web, papers | Prose summaries with links |

### What They All Have in Common

These tools operate on **published text** — they search, retrieve, summarize, and synthesize the *literature about* health data. They answer: **"What have researchers written about X?"**

## What ExposomeQL Does Differently

ExposomeQL operates on **the data itself** — not the literature about the data. It answers: **"What does the data actually show about X?"**

### The Fundamental Distinction

| Dimension | Literature Agents (Elicit, Consensus, BioMCP) | ExposomeQL |
|-----------|-----------------------------------------------|------------|
| **Data source** | Published papers (text) | Primary research data (66.8M pre-computed associations, NHANES individual-level data, CTD gene interactions, HHEAR cohort biomonitoring) |
| **What it queries** | What authors *reported* | What the data *shows* |
| **Computation** | Text retrieval + summarization | Survey-weighted regression, meta-analysis, dose-response modeling, mediation analysis |
| **Guardrails** | Citation verification | Epidemiological guardrails: survey weights, LOD handling, cell size suppression, multiple testing correction |
| **Reproducibility** | Links to papers | Returns executable R code for every computation |
| **Novel findings** | Limited to what's been published | Can discover associations never previously reported |
| **Confounding detection** | Cannot detect | Simpson's paradox test, biomarker vs dietary recall comparison, vibration of effects |
| **Triangulation** | Can cite multiple papers | Computationally integrates 3+ independent data sources with concordance assessment |

### Specific Capabilities No Literature Agent Can Provide

1. **"What is the association between PFOA and uric acid, adjusted for age, sex, and race, meta-analyzed across 10 NHANES cycles?"** — This requires actual regression on survey data, not text retrieval. ExposomeQL returns β=+0.111, p=7.6e-5 in 63ms.

2. **"Does the PFOA-cholesterol association show Simpson's paradox?"** — This requires comparing pooled vs cycle-specific estimates from the same dataset. Literature agents can only report what individual papers found; ExposomeQL detects the paradox computationally.

3. **"Is the dietary recall evidence for iron concordant with published meta-analyses?"** — This requires querying the EP-WAS atlas for iron-hemoglobin associations AND comparing direction against curated meta-analytic evidence (predominantly RCTs). ExposomeQL returns: 0% concordance (fully discordant — dietary recall is confounded).

4. **"Run a dose-response analysis of blood lead vs kidney function using restricted cubic splines."** — This runs actual R code on NHANES microdata with proper survey weights. No literature agent can do this.

5. **"Which of 9 PFAS compounds has the strongest association with uric acid?"** — ExposomeQL's `exposure_compare` tool queries all 9 in parallel and ranks them. A literature agent would need to find separate papers for each compound and manually compare.

### Comparison with Biomni (Stanford, 2025)

Biomni is the closest analogue to ExposomeQL — both are **primary data agents** that execute code on real datasets, not literature retrieval tools. The key difference is domain and methods:

| Dimension | Biomni | ExposomeQL |
|-----------|--------|------------|
| **Domain** | Molecular biology (genomics, single-cell, drug discovery) | Environmental epidemiology (exposome, population health) |
| **Primary data** | scRNA-seq, GWAS, proteomics, CRISPR screens | NHANES survey data, EP-WAS associations, HHEAR cohorts |
| **Statistical methods** | Standard bioinformatics pipelines | Survey-weighted regression, UWLS meta-analysis, design-corrected inference |
| **Data scale** | ~11GB data lake, 59 databases | 10GB EP-WAS + 1.8GB NHANES + CTD + HHEAR |
| **Tools** | 105 software + 150 specialized tools | 46 epidemiological tools + 12 resources |
| **Guardrails** | Sandbox execution warnings | Epidemiological guardrails: survey weights, LOD, cell size, multiple testing |
| **MCP support** | Yes (client) | Yes (server) |
| **Novel methods** | Action discovery agent, retrieval-augmented planning | Simpson's paradox detection, triangulation, confounding check |

**Critical gap Biomni cannot fill**: Even if NHANES were loaded into Biomni's data lake, Biomni would run naive regressions without survey weights and produce biased estimates. The epidemiological methods layer — design-corrected standard errors, cycle-pooled weight adjustment, LOD substitution, fasting subsample handling — is domain expertise encoded in computation, not something a general-purpose code agent can improvise.

**Integration opportunity**: Biomni supports MCP servers. ExposomeQL *is* an MCP server. A Biomni agent could:
1. Identify a GWAS hit for kidney function → find candidate genes
2. Call ExposomeQL's `ctd_chemical_genes` → find which environmental chemicals interact with those genes
3. Call ExposomeQL's `epwas_search` → check population-level associations in NHANES
4. Call ExposomeQL's `confounder_check` → verify the association isn't confounded

This is the **genes × environment** vision: molecular agents handle the G, ExposomeQL handles the E.

### Comparison with BioMCP

BioMCP is the closest existing MCP server to ExposomeQL. Both use the Model Context Protocol and serve biomedical data to AI agents. However:

| Feature | BioMCP | ExposomeQL |
|---------|--------|------------|
| Data type | Literature metadata (PubMed, ClinicalTrials.gov, variants) | Primary research data (survey microdata, pre-computed associations, gene interactions, cohort biomonitoring) |
| Computation | Search and retrieval | Statistical analysis (regression, meta-analysis, dose-response) |
| Epidemiological methods | None | Survey weights, LOD, cell size, multiple testing, cycle pooling |
| Environmental exposures | Not covered | 804 exposures × 346 phenotypes = 165K+ meta-analytic tests |
| Cohort data | None | 35+ HHEAR cohorts with individual-level biomonitoring |
| Triangulation | None | 3-source (EP-WAS + CTD + HHEAR) + nutrient (EP-WAS + meta-analytic evidence) |
| Tools | 12 entities | 46 tools + 17 resources |

**BioMCP tells you what papers say about a gene variant. ExposomeQL tells you what the data shows about an environmental exposure's effect on health across 100,000 participants.**

## The Complementary Role

ExposomeQL is not a replacement for literature agents — it is complementary:

1. **Literature agents** (Elicit, Consensus) identify *what has been studied* and *what authors concluded*
2. **ExposomeQL** provides *what the data actually shows*, with proper statistical methods and confounding assessment
3. **Together**, an AI agent could: use Elicit to find relevant papers → use ExposomeQL to verify claims against primary data → use BioMCP to look up genetic variants → produce a triangulated evidence report

This is the vision of **agentic science**: multiple specialized tools orchestrated by an LLM to conduct rigorous, reproducible research that would take a human team weeks.

### Integration with OpenClaw and Other Agent Frameworks

ExposomeQL is designed as a **portable skill** — any MCP-compatible agent framework can use it. The most immediate integration target is **OpenClaw**, the open-source AI agent framework (247K+ GitHub stars, March 2026) where over 65% of active skills already wrap MCP servers.

| Agent Framework | MCP Support | ExposomeQL Integration |
|----------------|-------------|----------------------|
| **OpenClaw** | Native — 134+ MCP tools, one-click skill install | Add as MCP skill via stdio or Streamable HTTP |
| **Claude Desktop** | Native — MCP is Anthropic's protocol | Current primary deployment |
| **Claude Code** | Native | Current development environment |
| **Biomni** | MCP client support | ExposomeQL as environmental health data layer |
| **Custom agents** (LangChain, CrewAI, AutoGen) | Via MCP client libraries | Any agent with MCP client SDK |

**Why this matters**: ExposomeQL is not locked to one AI platform. As MCP adoption grows (Anthropic, OpenAI, Google all supporting it), ExposomeQL becomes accessible to any researcher using any MCP-compatible agent. The `SKILL.md` file in the repository enables automatic discovery and registration on platforms like Smithery.

An OpenClaw user could ask: *"What are the health effects of PFAS, and does the CDC's assessment hold up?"* — OpenClaw routes to ExposomeQL, which runs `exposure_compare`, `simpson_paradox_test`, `confounder_check`, and `ctd_chemical_genes`, returning a data-driven critique in seconds.

## Key Differentiators for the Paper

For the NMI submission, emphasize:

1. **Primary data agent for environmental epidemiology** — ExposomeQL is to population health data what Biomni is to molecular biology data. Both analyze primary data with domain-specific methods; together they cover genes × environment.
2. **Epidemiological methods as a computation layer** — survey weights, LOD handling, cycle pooling, and multiple testing correction are enforced in code, not prompt engineering. A general-purpose agent running naive regressions on NHANES would get wrong answers.
3. **Triangulation is a computational primitive** — concordance across EP-WAS, CTD, HHEAR, and RCTs is calculated, not narrated. No literature agent (Elicit, Consensus) or molecular agent (Biomni) can do this.
4. **Novel discovery** — the uric acid case study found mechanistic convergence (PFOA + lead + cadmium → shared renal transporters) that no single paper had reported.
5. **Confounding detection** — Simpson's paradox test, albumin binding check, biomarker vs dietary recall validation (83% vs 50% concordance with RCTs). No other agent encodes this methodological reasoning.
6. **92% validation accuracy** — against 24 established findings, with 66ms per query across 165K tests.
7. **Opens a new domain for AI agents** — 70-90% of chronic disease risk is environmental, yet zero AI infrastructure existed for exposomics. ExposomeQL fills this gap for the emerging ecosystem of biomedical AI agents.
