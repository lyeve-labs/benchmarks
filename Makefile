# LyEve Performance Benchmarks
#
# Common entry points. Everything ultimately shells into harness/run.sh (to run
# load tests) or tools/*.mjs (to turn raw output into the published report).

SHELL := /bin/bash
TARGET   ?= lyeve
SCENARIO ?= all
PROFILE  ?= blog
FULL     ?= 0
PULL     ?= 0
DURATION ?=

.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

.PHONY: doctor
doctor: ## Check this machine has Docker, k6 and Node
	@harness/run.sh --doctor

.PHONY: run
run: ## Run one target/scenario: make run TARGET=lyeve SCENARIO=S01 [PULL=1]
	@harness/run.sh --target $(TARGET) --scenario $(SCENARIO) $(if $(DURATION),--duration $(DURATION),) $(if $(filter 1,$(PULL)),--pull,)

.PHONY: sweep
sweep: ## Run every scenario against every self-hostable target [PULL=1]
	@harness/run.sh --sweep $(if $(filter 1,$(PULL)),--pull,)

.PHONY: refresh
refresh: ## Pull the pinned official images, then: make sweep
	@img="$${LYEVE_IMAGE:-$$(node -p 'require("./targets/targets.json").targets.find(t=>t.id==="lyeve").image')}"; \
	  docker pull "$$img" || echo "  $$img not pullable here, so the local image runs (build it and name it in LYEVE_IMAGE)"
	@docker pull directus/directus:11 || true
	@echo "images ready, now run: make sweep"

.PHONY: profile
profile: ## Run a real-world profile: make profile PROFILE=blog TARGET=lyeve [FULL=1]
	@FULL=$(FULL) harness/run.sh --profile $(PROFILE) --target $(TARGET)

.PHONY: report
report: ## Regenerate results.json + RESULTS.md from results/raw/
	@node tools/generate-report.mjs

.PHONY: validate
validate: ## Validate targets.json / scenarios.json / results.json shape
	@node tools/validate.mjs

.PHONY: clean
clean: ## Remove scratch load-test output (keeps curated runs)
	@rm -rf results/raw/tmp && echo "cleaned results/raw/tmp"
