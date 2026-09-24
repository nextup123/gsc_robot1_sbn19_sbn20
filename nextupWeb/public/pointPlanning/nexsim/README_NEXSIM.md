# NexSim test view — integration notes (v2)

Self-contained 3D robot viewer embedded into the pointPlanning page for testing.

## What was added / changed

1. `public/nexsim/` — bundle + launcher + meshes (served at /nexsim/).
   - `nexsim-viewer.js`  — built viewer bundle (now includes per-joint jog preview)
   - `nexsim-embed.js`   — docked-left, resizable window; hijacks the page jog
                           buttons for preview-only while open; self-resolves its
                           asset base from its own <script> URL.
   - `meshes/*.glb`

2. `public/pointPlanning/index.html`, 2 lines tagged NEXSIM:
   - a `NexSim` button placed BEFORE "Reload Points" in `.header-actions`
   - a `<script src="/nexsim/nexsim-embed.js">` before `</body>`

No server.js change.

## Behaviour

- Docked to the LEFT half of the screen, resizable by dragging its right edge,
  so the page's own Joint/Cartesian jog buttons stay reachable on the right.
- While the window is OPEN, pressing a page jog button PREVIEWS in the sim and
  the real servo command is SUPPRESSED (preview-only):
    * Cartesian X/Y/Z/R/P/W  -> arrows or ghost (toggle in titlebar)
    * Joint J1..J6           -> ghost with that joint offset ~15 deg
  Release the button to clear the preview. Closing the window restores normal
  button behaviour (nothing intercepted).
- Nothing loads until the button is clicked. Close -> full dispose (render loop
  stopped, rosbridge socket closed, GPU freed).

## Paths

The <script> src is root-absolute `/nexsim/nexsim-embed.js`, which is correct
for `express.static("public")` (page at /pointPlanning/, assets at /nexsim/).
If your HMI is served behind a sub-path/proxy and that 404s, change the src to
the relative form `nexsim/nexsim-embed.js`. The embed then auto-resolves the
bundle + meshes relative to wherever it loaded from, so no other change needed.

## rosbridge

Connects to ws://<page-host>:9090 by default. Set ROSBRIDGE_URL near the top of
nexsim-embed.js if rosbridge runs elsewhere.

## Uninstall

Delete `public/nexsim/` and the 2 NEXSIM-tagged lines in pointPlanning/index.html.
