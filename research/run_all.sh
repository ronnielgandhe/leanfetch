#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
: "${OPENAI_API_KEY:?}" "${ANTHROPIC_API_KEY:?}" "${GOOGLE_API_KEY:?}"
test -d .venv || { python3 -m venv .venv && .venv/bin/pip -q install -r requirements.txt; }
./stage1_targets.sh
.venv/bin/python callsites/classify.py
.venv/bin/python stage1b_defaults_alive.py
mkdir -p data/raw
[ -f data/raw/fewnerd_test.parquet ] || curl -sL -o data/raw/fewnerd_test.parquet https://huggingface.co/api/datasets/DFKI-SLT/few-nerd/parquet/supervised/test/0.parquet
[ -f data/raw/hotpot_dev_distractor.parquet ] || curl -sL -o data/raw/hotpot_dev_distractor.parquet https://huggingface.co/api/datasets/hotpotqa/hotpot_qa/parquet/distractor/validation/0.parquet
[ -f data/raw/halueval_qa.json ] || curl -sL -o data/raw/halueval_qa.json https://raw.githubusercontent.com/RUCAIBox/HaluEval/main/data/qa_data.json
.venv/bin/python stage2_data.py
.venv/bin/python stage3_run.py t3 main
.venv/bin/python stage3_run.py t2 main
.venv/bin/python stage3_run.py t1 main --limit 150
.venv/bin/python stage4_analyze.py main
.venv/bin/python stage5_charts.py
.venv/bin/python stage6_appendix.py
