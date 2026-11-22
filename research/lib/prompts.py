import ast
import json
from pathlib import Path

REPOS = Path(__file__).resolve().parent.parent / "data/raw/repos"


def _tree(rel):
    return ast.parse((REPOS / rel).read_text())


def _module_str(rel, name):
    for node in _tree(rel).body:
        if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == name for t in node.targets):
            return ast.literal_eval(node.value)
    raise KeyError(name)


_G = "graphrag/packages/graphrag/graphrag/prompts/index/extract_graph.py"
GRAPH_EXTRACTION_PROMPT = _module_str(_G, "GRAPH_EXTRACTION_PROMPT")
CONTINUE_PROMPT = _module_str(_G, "CONTINUE_PROMPT")


def _llama_qa():
    tree = _tree("llama_index/llama-index-core/llama_index/core/prompts/chat_prompts.py")
    system = user = None
    for node in tree.body:
        if isinstance(node, ast.Assign) and node.targets[0].id == "TEXT_QA_SYSTEM_PROMPT":
            system = ast.literal_eval(next(k.value for k in node.value.keywords if k.arg == "content"))
        if isinstance(node, ast.Assign) and node.targets[0].id == "TEXT_QA_PROMPT_TMPL_MSGS":
            call = node.value.elts[1]
            user = ast.literal_eval(next(k.value for k in call.keywords if k.arg == "content"))
    return system, user


TEXT_QA_SYSTEM_PROMPT, TEXT_QA_USER_TMPL = _llama_qa()


def haystack_faithfulness_template():
    tree = _tree("haystack/haystack/components/evaluators/faithfulness.py")
    examples = instructions = None
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and getattr(node.targets[0], "id", None) == "_DEFAULT_EXAMPLES":
            examples = ast.literal_eval(node.value)
        if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Attribute) and node.targets[0].attr == "instructions":
            instructions = ast.literal_eval(node.value)
    inputs = ["questions", "contexts", "predicted_answers"]
    outputs = ["statements", "statement_scores"]
    inputs_section = "{" + ", ".join([f'"{n}": {{{{ {n} }}}}' for n in inputs]) + "}"
    examples_section = "\n".join(
        ["Inputs:\n" + json.dumps(e["inputs"]) + "\nOutputs:\n" + json.dumps(e["outputs"]) for e in examples]
    )
    return (
        f"Instructions:\n"
        f"{instructions}\n\n"
        f"Generate the response in JSON format with the following keys:\n"
        f"{json.dumps(outputs)}\n"
        f"Consider the instructions and the examples below to determine those values.\n\n"
        f"Examples:\n"
        f"{examples_section}\n\n"
        f"Inputs:\n"
        f"{inputs_section}\n"
        f"Outputs:\n"
    )
