from __future__ import annotations

import importlib
import os
import sys
import tempfile
import unittest
from pathlib import Path

from PIL import ImageDraw


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def load_modules(data_dir: Path):
    os.environ["COMFYPENCIL_DATA_DIR"] = str(data_dir)
    import backend.constants as constants
    import backend.nodes as nodes
    import backend.rendering as rendering
    import backend.store as store

    constants = importlib.reload(constants)
    rendering = importlib.reload(rendering)
    store = importlib.reload(store)
    nodes = importlib.reload(nodes)
    return store, rendering, nodes


class ComfyPencilBackendTests(unittest.TestCase):
    def test_studio_can_encode_split_prompt_conditioning(self):
        class FakeClip:
            def tokenize(self, text):
                return {"g": [f"g:{text}"], "l": [f"l:{text}"]}

            def encode_from_tokens(self, tokens, return_pooled=False):
                self.tokens = tokens
                return ({"encoded": tokens}, {"pooled": True}) if return_pooled else {"encoded": tokens}

        with tempfile.TemporaryDirectory() as temp_dir:
            _, _, nodes = load_modules(Path(temp_dir))
            studio = nodes.ComfyPencilStudio()
            clip = FakeClip()

            result = studio.render(
                "Prompt Test",
                "",
                0,
                0,
                "misty forest at dawn",
                96,
                64,
                "transparent",
                "#ffffff",
                False,
                clip=clip,
                unique_id="7",
            )

            conditioning = result[-1]
            self.assertEqual(len(conditioning), 1)
            self.assertEqual(conditioning[0][0]["encoded"]["g"], ["g:misty forest at dawn"])
            self.assertEqual(conditioning[0][1]["pooled_output"], {"pooled": True})

    def test_create_and_render_document(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            store, rendering, _ = load_modules(Path(temp_dir))
            document = store.create_document(name="Unit Test", width=320, height=180)
            runtime = store.load_runtime_document(document["id"])

            self.assertEqual(runtime["name"], "Unit Test")
            self.assertEqual(runtime["width"], 320)
            self.assertEqual(runtime["height"], 180)
            self.assertEqual(len(runtime["layers"]), 1)

            image, mask = rendering.render_document(runtime, flatten_background=False)
            self.assertEqual(image.size, (320, 180))
            self.assertEqual(mask.size, (320, 180))

    def test_studio_render_respects_widget_canvas_size_for_existing_document(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            store, rendering, nodes = load_modules(Path(temp_dir))
            created = store.create_document(name="Resize Test", width=320, height=180)
            runtime = store.load_runtime_document(created["id"])
            studio = nodes.ComfyPencilStudio()

            document, image_tensor, mask_tensor, *_ = studio.render(
                "Resize Test",
                created["id"],
                created["revision"],
                0,
                "",
                160,
                96,
                "transparent",
                "#ffffff",
                False,
                document=runtime,
                unique_id="11",
            )

            rendered_image = rendering.tensor_to_pil_rgb(image_tensor)
            rendered_mask = rendering.mask_to_pil(mask_tensor)
            self.assertEqual(document["width"], 160)
            self.assertEqual(document["height"], 96)
            self.assertEqual(rendered_image.size, (160, 96))
            self.assertEqual(rendered_mask.size, (160, 96))

    def test_runtime_save_increments_revision(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            store, rendering, _ = load_modules(Path(temp_dir))
            document = store.create_document(name="Revision Test", width=128, height=128)
            runtime = store.load_runtime_document(document["id"])

            first_layer = runtime["layers"][0]
            draw = ImageDraw.Draw(first_layer["image"])
            draw.rectangle((16, 16, 80, 80), fill=(255, 0, 0, 255))
            saved = store.save_runtime_document(runtime)

            self.assertEqual(saved["revision"], 2)

            image, mask = rendering.render_document(saved, flatten_background=False)
            self.assertEqual(image.getbbox(), (16, 16, 81, 81))
            self.assertIsNotNone(mask.getbbox())

    def test_alpha_lock_metadata_round_trips(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            store, _, _ = load_modules(Path(temp_dir))
            document = store.create_document(name="Alpha Lock Test", width=128, height=128)
            document["layers"][0]["alphaLocked"] = True

            saved = store.save_document(document)
            metadata = store.load_document_metadata(saved["id"])
            runtime = store.load_runtime_document(saved["id"])

            self.assertTrue(metadata["layers"][0]["alphaLocked"])
            self.assertTrue(runtime["layers"][0]["alphaLocked"])

    def test_assist_metadata_round_trips(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            store, _, _ = load_modules(Path(temp_dir))
            document = store.create_document(name="Assist Test", width=256, height=256)
            document["assist"] = {"rotation": 27.5, "symmetry": "quadrant", "strokeConstraint": 30}

            saved = store.save_document(document)
            metadata = store.load_document_metadata(saved["id"])
            runtime = store.load_runtime_document(saved["id"])

            self.assertEqual(metadata["assist"]["symmetry"], "quadrant")
            self.assertAlmostEqual(float(metadata["assist"]["rotation"]), 27.5)
            self.assertEqual(int(metadata["assist"]["strokeConstraint"]), 30)
            self.assertEqual(runtime["assist"]["symmetry"], "quadrant")
            self.assertAlmostEqual(float(runtime["assist"]["rotation"]), 27.5)
            self.assertEqual(int(runtime["assist"]["strokeConstraint"]), 30)

    def test_paint_metadata_round_trips(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            store, _, _ = load_modules(Path(temp_dir))
            document = store.create_document(name="Paint Test", width=192, height=192)
            document["paint"] = {"primaryColor": "#4aa7ff", "secondaryColor": "#f6814f"}

            saved = store.save_document(document)
            metadata = store.load_document_metadata(saved["id"])
            runtime = store.load_runtime_document(saved["id"])

            self.assertEqual(metadata["paint"]["primaryColor"], "#4aa7ff")
            self.assertEqual(metadata["paint"]["secondaryColor"], "#f6814f")
            self.assertEqual(runtime["paint"]["primaryColor"], "#4aa7ff")
            self.assertEqual(runtime["paint"]["secondaryColor"], "#f6814f")

    def test_split_preview_is_saved(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            store, _, _ = load_modules(Path(temp_dir))
            document = store.create_document(name="Preview Test", width=96, height=64)
            preview = store.make_blank_rgba(96, 64)
            draw = ImageDraw.Draw(preview)
            draw.rectangle((8, 8, 88, 56), fill=(24, 120, 255, 255))

            path = store.save_split_preview(document["id"], preview)

            self.assertTrue(path.exists())
            self.assertEqual(path, store.split_preview_image_path(document["id"]))

    def test_preview_receiver_uses_studio_node_fallback_key(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            store, rendering, nodes = load_modules(Path(temp_dir))
            studio = nodes.ComfyPencilStudio()
            receiver = nodes.ComfyPencilReceivePreview()
            preview = store.make_blank_rgba(96, 64)
            draw = ImageDraw.Draw(preview)
            draw.rectangle((12, 12, 80, 52), fill=(255, 80, 32, 255))
            image_tensor = rendering.pil_to_image_tensor(preview)

            document, *_ = studio.render(
                "Fallback Preview",
                "",
                0,
                96,
                64,
                "transparent",
                "#ffffff",
                False,
                unique_id="42",
            )
            self.assertEqual(document["previewKey"], "studio-node-42")

            runtime_document, returned_image, status = receiver.receive_preview(document, image_tensor, "fit")

            self.assertEqual(runtime_document["previewKey"], "studio-node-42")
            self.assertIsNotNone(returned_image)
            self.assertIn("studio-node-42", status)
            self.assertTrue(store.split_preview_image_path("studio-node-42").exists())

    def test_preview_metadata_round_trips(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            store, _, _ = load_modules(Path(temp_dir))
            document = store.create_document(name="Preview Meta Test", width=128, height=128)
            document["previewKey"] = "studio-node-9"
            document["studioNodeId"] = "9"

            saved = store.save_document(document)
            metadata = store.load_document_metadata(saved["id"])
            runtime = store.load_runtime_document(saved["id"])

            self.assertEqual(metadata["previewKey"], "studio-node-9")
            self.assertEqual(metadata["studioNodeId"], "9")
            self.assertEqual(runtime["previewKey"], "studio-node-9")
            self.assertEqual(runtime["studioNodeId"], "9")

    def test_project_bundle_export_import_round_trips_artwork(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            store, rendering, _ = load_modules(Path(temp_dir))
            document = store.create_document(name="Project Bundle Test", width=144, height=96)
            runtime = store.load_runtime_document(document["id"])

            first_layer = runtime["layers"][0]
            draw = ImageDraw.Draw(first_layer["image"])
            draw.rectangle((12, 10, 92, 64), fill=(32, 140, 255, 255))
            runtime["layers"][0]["opacity"] = 0.8
            runtime["layers"][0]["blendMode"] = "multiply"
            runtime["layers"][0]["alphaLocked"] = True
            runtime["assist"] = {"rotation": 18.0, "symmetry": "vertical", "strokeConstraint": 15}
            saved = store.save_runtime_document(runtime)

            bundle = store.export_project_bundle(saved["id"])
            imported = store.import_project_bundle(bundle)
            imported_runtime = store.load_runtime_document(imported["id"])

            self.assertEqual(bundle["format"], store.PROJECT_FILE_FORMAT)
            self.assertEqual(bundle["version"], store.PROJECT_FILE_VERSION)
            self.assertEqual(bundle["document"]["name"], "Project Bundle Test")
            self.assertEqual(imported["name"], "Project Bundle Test")
            self.assertNotEqual(imported["id"], saved["id"])
            self.assertEqual(imported["revision"], 1)
            self.assertEqual(imported_runtime["assist"]["symmetry"], "vertical")
            self.assertEqual(imported_runtime["assist"]["strokeConstraint"], 15)
            self.assertEqual(imported_runtime["layers"][0]["blendMode"], "multiply")
            self.assertTrue(imported_runtime["layers"][0]["alphaLocked"])

            image, mask = rendering.render_document(imported_runtime, flatten_background=False)
            self.assertEqual(image.getbbox(), (12, 10, 93, 65))
            self.assertIsNotNone(mask.getbbox())

    def test_material_maps_round_trip_and_render_outputs(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            store, rendering, nodes = load_modules(Path(temp_dir))
            document = store.create_document(name="Material Maps Test", width=96, height=96)
            runtime = store.load_runtime_document(document["id"])

            first_layer = runtime["layers"][0]
            color_draw = ImageDraw.Draw(first_layer["image"])
            color_draw.rectangle((12, 12, 76, 76), fill=(180, 120, 64, 255))
            material_draw = ImageDraw.Draw(first_layer["materialImage"])
            material_draw.rectangle((12, 12, 76, 76), fill=(196, 128, 240, 255))
            saved = store.save_runtime_document(runtime)

            bundle = store.export_project_bundle(saved["id"])
            self.assertIn("layerMaterialImages", bundle)
            self.assertIn(saved["layers"][0]["id"], bundle["layerMaterialImages"])

            imported = store.import_project_bundle(bundle)
            imported_runtime = store.load_runtime_document(imported["id"])
            self.assertIsNotNone(imported_runtime["layers"][0]["materialImage"].getbbox())

            material_maps = rendering.render_document_material_maps(imported_runtime)
            self.assertEqual(set(material_maps), {"height", "roughness", "specular", "light"})
            self.assertEqual(material_maps["height"].size, (96, 96))
            self.assertIsNotNone(material_maps["height"].getbbox())
            self.assertIsNotNone(material_maps["roughness"].getbbox())
            self.assertIsNotNone(material_maps["specular"].getbbox())
            self.assertIsNotNone(material_maps["light"].getbbox())

            renderer = nodes.ComfyPencilRenderDocument()
            rendered = renderer.render_document(imported_runtime, False)
            self.assertEqual(len(rendered), 7)
            self.assertIsNotNone(rendered[2])
            self.assertIsNotNone(rendered[3])
            self.assertIsNotNone(rendered[4])
            self.assertIsNotNone(rendered[5])

    def test_save_document_accepts_split_material_payloads(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            store, _, _ = load_modules(Path(temp_dir))
            document = store.create_document(name="Split Payload Test", width=72, height=72)
            runtime = store.load_runtime_document(document["id"])
            layer_id = runtime["layers"][0]["id"]

            color_image = store.make_blank_rgba(72, 72)
            color_draw = ImageDraw.Draw(color_image)
            color_draw.rectangle((8, 8, 40, 40), fill=(255, 0, 0, 255))

            material_image = store.make_blank_rgba(72, 72)
            material_draw = ImageDraw.Draw(material_image)
            material_draw.rectangle((16, 16, 48, 48), fill=(200, 140, 120, 255))

            saved = store.save_document(
                runtime,
                layer_images={layer_id: color_image},
                layer_material_images={layer_id: material_image},
            )
            loaded = store.load_runtime_document(saved["id"])

            self.assertIsNotNone(loaded["layers"][0]["image"].getbbox())
            self.assertIsNotNone(loaded["layers"][0]["materialImage"].getbbox())


if __name__ == "__main__":
    unittest.main()
