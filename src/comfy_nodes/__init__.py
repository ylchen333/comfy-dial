"""comfy-dial custom nodes (local mode). Tested Oct 18: Comfy Cloud rejects the unpublished ComfyDial_SaveCameraPosesJSON as unknown_class_type, while the pack workflow validates. Untested whether publishing to the Registry changes that."""
import json
import os

from .poses import build_poses

try:
    from comfy_api.latest import ComfyExtension, io, ui
except ImportError:  # outside ComfyUI (pytest, CLI): pure helpers in .poses still work
    io = None

if io is not None:
    DA3Geometry = io.Custom("DA3_GEOMETRY")


    class SaveCameraPosesJSON(io.ComfyNode):
        @classmethod
        def define_schema(cls) -> io.Schema:
            return io.Schema(
                node_id="ComfyDial_SaveCameraPosesJSON",
                display_name="Save Camera Poses JSON",
                category="comfy_dial",
                description="Writes DA3 multiview extrinsics/intrinsics as poses.json (three.js Y-up c2w).",
                inputs=[
                    DA3Geometry.Input("da3_geometry"),
                    io.String.Input("filename_prefix", default="poses"),
                    io.Float.Input("fps", default=25.0, min=0.0, max=240.0),
                ],
                outputs=[],
                is_output_node=True,
            )

        @classmethod
        def execute(cls, da3_geometry, filename_prefix, fps) -> io.NodeOutput:
            import folder_paths  # ComfyUI

            ext = da3_geometry["extrinsics"][0].detach().cpu().float().numpy()   # (S,3,4) w2c
            k = da3_geometry["intrinsics"][0].detach().cpu().float().numpy()     # (S,3,3)
            doc = build_poses(ext, k, fps=fps or 25.0)
            out_dir, name, counter, sub, _ = folder_paths.get_save_image_path(
                filename_prefix, folder_paths.get_output_directory())
            fname = f"{name}_{counter:05}_.json"
            with open(os.path.join(out_dir, fname), "w") as f:
                json.dump(doc, f, indent=2)
            return io.NodeOutput(ui=ui.PreviewText(f"{sub}/{fname}" if sub else fname))


    class ComfyDialExtension(ComfyExtension):
        async def get_node_list(self) -> list[type[io.ComfyNode]]:
            return [SaveCameraPosesJSON]


    async def comfy_entrypoint() -> ComfyDialExtension:
        return ComfyDialExtension()
