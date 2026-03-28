from __future__ import annotations

import importlib
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def load_nodes_module(data_dir: Path):
    os.environ["COMFYPENCIL_DATA_DIR"] = str(data_dir)
    import backend.nodes as nodes

    return importlib.reload(nodes)


def normalize_output_label(value: str) -> str:
    return str(value or "").strip().lower().replace("_", " ")


class ComfyPencilRepoAssetTests(unittest.TestCase):
    def test_readme_includes_skill_attribution_footer(self):
        readme = (ROOT / "README.md").read_text(encoding="utf-8")
        self.assertIn(
            "This extension/addon was created using Codex skill designed by Cris K B https://github.com/criskb/comfyui-node-extension-builder",
            readme,
        )

    def test_node_defs_match_current_node_outputs(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            nodes = load_nodes_module(Path(temp_dir))
            node_defs = json.loads((ROOT / "locales" / "en" / "nodeDefs.json").read_text(encoding="utf-8"))

            expected_outputs = {
                nodes.STUDIO_NODE_ID: list(nodes.ComfyPencilStudio.RETURN_NAMES),
                nodes.RENDER_NODE_ID: list(nodes.ComfyPencilRenderDocument.RETURN_NAMES),
                nodes.IMPORT_NODE_ID: list(nodes.ComfyPencilImportLayer.RETURN_NAMES),
                nodes.EXTRACT_NODE_ID: list(nodes.ComfyPencilExtractLayer.RETURN_NAMES),
                nodes.PREVIEW_RECEIVER_NODE_ID: list(nodes.ComfyPencilReceivePreview.RETURN_NAMES),
            }

            for node_id, return_names in expected_outputs.items():
                definition = node_defs.get(node_id)
                self.assertIsNotNone(definition, f"Missing locale definition for {node_id}")
                outputs = definition.get("outputs") or {}
                self.assertEqual(
                    len(outputs),
                    len(return_names),
                    f"Output count drift for {node_id}",
                )
                for index, name in enumerate(return_names):
                    output_def = outputs.get(str(index))
                    self.assertIsNotNone(output_def, f"Missing output {index} for {node_id}")
                    self.assertEqual(
                        normalize_output_label(output_def.get("name")),
                        normalize_output_label(name),
                        f"Output name drift for {node_id} at index {index}",
                    )

    def test_example_workflows_have_matching_thumbnails(self):
        workflows_dir = ROOT / "example_workflows"
        workflow_paths = sorted(workflows_dir.glob("*.json"))
        self.assertGreaterEqual(len(workflow_paths), 3)

        for workflow_path in workflow_paths:
            data = json.loads(workflow_path.read_text(encoding="utf-8"))
            self.assertIn("nodes", data, f"Missing nodes array in {workflow_path.name}")
            self.assertIsInstance(data["nodes"], list, f"Invalid nodes array in {workflow_path.name}")

            thumbnail_path = workflow_path.with_suffix(".png")
            self.assertTrue(thumbnail_path.exists(), f"Missing thumbnail for {workflow_path.name}")
            with Image.open(thumbnail_path) as thumbnail:
                self.assertGreaterEqual(thumbnail.size[0], 640)
                self.assertGreaterEqual(thumbnail.size[1], 360)

    def test_example_workflows_reference_current_output_names(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            nodes = load_nodes_module(Path(temp_dir))
            expected_studio_outputs = list(nodes.ComfyPencilStudio.RETURN_NAMES)
            expected_render_outputs = list(nodes.ComfyPencilRenderDocument.RETURN_NAMES)

        workflows = {
            "comfypencil_basic.json": {
                "ComfyPencilStudio": expected_studio_outputs,
                "ComfyPencilRenderDocument": expected_render_outputs,
            },
            "comfypencil_split_preview.json": {
                "ComfyPencilStudio": expected_studio_outputs,
                "ComfyPencilRenderDocument": expected_render_outputs,
                "ComfyPencilReceivePreview": ["document", "image", "status"],
            },
            "comfypencil_material_maps.json": {
                "ComfyPencilStudio": expected_studio_outputs,
                "ComfyPencilRenderDocument": expected_render_outputs,
            },
        }

        for filename, expected_nodes in workflows.items():
            payload = json.loads((ROOT / "example_workflows" / filename).read_text(encoding="utf-8"))
            node_map = {node["type"]: node for node in payload.get("nodes", [])}
            for node_type, expected_outputs in expected_nodes.items():
                self.assertIn(node_type, node_map, f"{filename} is missing {node_type}")
                actual_outputs = [output.get("name") for output in node_map[node_type].get("outputs", [])]
                self.assertEqual(actual_outputs, expected_outputs, f"{filename} drifted for {node_type}")


if __name__ == "__main__":
    unittest.main()
