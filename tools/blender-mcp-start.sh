#!/bin/bash
# Launch Blender with the BlenderMCP server already listening on port 9876.
# The addon is installed into Blender's user addons dir (see tools/addon.py).
exec /Applications/Blender.app/Contents/MacOS/Blender --python-expr "
import bpy

def _start():
    try:
        bpy.ops.blendermcp.start_server()
        print('BlenderMCP: server started on port', bpy.context.scene.blendermcp_port)
    except Exception as e:
        print('BlenderMCP: autostart failed:', e)
    return None

bpy.app.timers.register(_start, first_interval=1.5)
"
