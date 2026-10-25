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

.PHONY: small
small: ## Run one target alone on a small remote server: make small TARGET=lyeve HOST=root@203.0.113.10 KEY=~/.ssh/bench-vm [PROVIDER= PLAN= RATES="25 50 100"]
	@harness/small.sh --target $(TARGET) --scenario $(SCENARIO)

.PHONY: small-sweep
small-sweep: ## Run a small-server campaign, every target and read scenario in rounds: make small-sweep HOST= KEY= CAMPAIGN= [ROUNDS=3 PROVIDER= PLAN=]
	@harness/small-sweep.sh

.PHONY: small-report
small-report: ## Summarize every run in results/raw/small/ again, then regenerate results/small.json + results/SMALL.md
	@for d in results/raw/small/*/; do \
	  if [ -f "$$d/small.json" ]; then node tools/small-summary.mjs "$$d" >/dev/null || exit 1; fi; \
	done
	@node tools/small-report.mjs

.PHONY: report
report: ## Regenerate results.json + RESULTS.md from results/raw/
	@node tools/generate-report.mjs

.PHONY: validate
validate: ## Validate targets.json / scenarios.json / results.json shape
	@node tools/validate.mjs

.PHONY: clean
clean: ## Remove scratch load-test output (keeps curated runs)
	@rm -rf results/raw/tmp && echo "cleaned results/raw/tmp"
