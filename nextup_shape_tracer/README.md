# nextup_shape_tracer

Closed-loop Cartesian shape tracer for the Nextup 6-DOF arm. It draws a shape by
reading the **actual** tool pose from TF 50 times a second and commanding a
velocity that corrects the tool back onto the path. Real-time kinematics and the
safety guards live in `moveit_servo`; this node is the eyes and the brain.

**v2.1** replaces the wall-clock reference with an **arc-length reference and a
cross-track freeze gate** that prevents the inward-spiral failure. See
`CHANGES_reference_freeze.md`.

---

## Build

```bash
cd ~/NextupRobot
colcon build --packages-select nextup_shape_tracer
source install/setup.bash
```

On a memory-constrained machine:
```bash
MAKEFLAGS="-j1" colcon build --packages-select nextup_shape_tracer --parallel-workers 1
```

## Prove the fix offline (no robot)

```bash
ros2 run nextup_shape_tracer validate_reference_freeze   # -> ALL PASS
ros2 run nextup_shape_tracer validate_control_law        # the feedforward table
```

`validate_reference_freeze` proves the freeze gate ignores phase lag (even 175
degrees behind) and measures radial offset exactly. This is the distinction that
matters: a gate on TOTAL error freezes healthy traces and makes the tool
overshoot; the gate uses CROSS-TRACK (perpendicular) distance instead.

## Run on hardware

```bash
# 1. servo
ros2 service call /servo_node/start_servo std_srvs/srv/Trigger {}
# 2. the tracer (autorun) -- a 60mm circle at 3mm/s, the validated setting
ros2 launch nextup_shape_tracer shape_tracer.launch.py size:=0.06 speed:=0.003
# 3. score it
ros2 run nextup_shape_tracer shape_score.py shape_circle_trace.csv --target-radius 0.03
```

The circle that used to spiral:
```bash
ros2 launch nextup_shape_tracer shape_tracer.launch.py size:=0.15 speed:=0.015
```
Watch for `[FROZEN]` in the log -- that is the reference waiting for the arm,
working as intended. It should trace a circle, not a spiral.

## The two error numbers

The node reports one `err_mm` -- the distance to where the reference is at this
instant. That conflates two different things:

| | what it is | matters? |
|---|---|---|
| **radial / cross-track** | perpendicular distance to the **path** | **yes** -- the shape error |
| **phase lag** | distance **along** the path | no -- the tool is on the path, just behind |

Judge a trace on **cross-track error and roundness**, never on the raw `err_mm`.
The `shape_score.py` circle fit gives you both.

## Key parameters (config/shape_tracer.yaml)

| param | default | note |
|---|---|---|
| `kp` | 3.0 | position gain. Raise only after measuring loop delay. |
| `feedforward` | true | what makes low-gain accurate. Leave on. |
| `vmax` | 0.05 | hard safety clamp on commanded twist speed |
| `freeze_error` | 0.002 | **cross-track** gate (m). NOT total error. |
| `watch_servo_status` | true | freeze on servo HALT (2/4/5), not decel (1/3/6) |
| `cross_search_window` | 60 | segments searched each side of the phase index |

## Web HMI

The `web/` directory contains `index.html` and its vendored `roslib.min.js`.
Open the file directly -- no server needed:

```bash
xdg-open ~/NextupRobot/src/nextup_shape_tracer/web/index.html
```

It connects to rosbridge on port 9090, commands the node over `~/command`, and
plots `~/diagnostics` live. There is no simulator -- every point comes from the
robot. The panel splits error into **radial** (the shape error) and **phase lag**
(harmless), reading the node's own `cross_mm` for the radial figure so the
display and the freeze gate agree. It logs `[FROZEN]` when the reference is
waiting for the arm.

Full HMI startup:
```bash
ros2 launch rosbridge_server rosbridge_websocket_launch.xml
ros2 service call /servo_node/start_servo std_srvs/srv/Trigger {}
ros2 launch nextup_shape_tracer shape_tracer.launch.py autorun:=false
xdg-open ~/NextupRobot/src/nextup_shape_tracer/web/index.html
```
Header must read `ROBOT LINKED`, then press Run. The real arm moves.

## System conventions

- `points.yaml` stores xyz in **centimetres** and rpy in **degrees**.
- Atomic YAML writes (tmp -> fsync -> rename).
- FastDDS shared-memory cleanup (`rm -f /dev/shm/fastrtps_*`) on every launch.
