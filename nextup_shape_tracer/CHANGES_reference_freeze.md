# Reference-Freeze Fix — What Changed and Why

## The bug this fixes
`shape_tracer_node` advanced its path reference on a **wall clock**
(`dist = speed × t`). When moveit_servo slowed the arm (singularity
deceleration, joint bound, halt), the arm fell behind but the reference kept
going. The position error then pointed **along** the path, the correction drove
the tool **forward** instead of **outward**, and the circle **spiraled into its
centre**. A 150 mm circle at 15 mm/s collapsed from 75 mm radius to a small loop,
90+ mm error.

## Why the FIRST attempt failed (+66 mm)
That attempt froze the reference on **total error** `|p_ref − p_act|`. But total
error is dominated by **phase lag**, which is harmless and always present. At
10 mm/s the total is 3.79 mm against a 4 mm gate — 0.21 mm margin. It stuttered,
and while frozen the tool kept driving at a stationary reference and **overshot
outward**: +66 mm on the fitted diameter.

## The correct fix
Advance the reference by **arc length**, and freeze it on **cross-track**
(perpendicular) distance to the path — never total error.

```
cross = perpendicular distance from tool to the reference path
if (cross < freeze_error AND servo has not HALTED)
    advance the reference by  speed·dt / perimeter
else
    freeze and wait
```

Measured cross-track on this arm (60 mm circle, kp=3):

| feed | cross-track | phase | total |
|------|-------------|-------|-------|
| 3 mm/s | 0.023 mm | 0.888 mm | 0.888 mm |
| 6 mm/s | 0.335 mm | 3.060 mm | 3.078 mm |
| 10 mm/s | 0.437 mm | 3.768 mm | 3.793 mm |

`freeze_error = 2 mm` → 4.6× headroom over the worst healthy run, and still
fires instantly on the spiral (cross-track ~84 mm there).

## Key properties
- **Healthy traces are unchanged by construction.** When the tool is on the
  path, arc-length advance equals the old wall-clock advance exactly. The fix
  differs only when the tool leaves the path — the case the old code broke.
- **Only HALT codes freeze.** moveit_servo codes 1/3/6 are *decelerations*
  (arm still moving) and fire constantly because its singularity thresholds are
  condition-number based (your smin survey: 30–80 in healthy poses). Freezing on
  those would stall every trace. A slowed arm shows up as cross-track error
  instead. Only 2 (singularity halt), 4 (collision halt), 5 (joint bound) freeze.
- **Escalating search:** cross-track uses a windowed scan (O(window)); a windowed
  scan can only over-estimate, so if the windowed value would trip the gate we
  confirm with a full O(n) scan first. Cheap when healthy, exact when it matters.

## New parameters (config/shape_tracer.yaml)
```yaml
freeze_error: 0.002        # m; CROSS-TRACK gate (NOT total error)
freeze_timeout: 15.0       # s; abort if frozen this long continuously
stall_timeout_factor: 4.0  # abort if trace exceeds factor × nominal time
cross_search_window: 60    # segments searched either side of the phase index
watch_servo_status: true   # subscribe to <servo_ns>/status; freeze on HALT only
```
Also: `kp` default raised 2.0 → 3.0 (matches your validated hardware runs).

## New diagnostics fields
`~/diagnostics` JSON now includes `cross_mm`, `frozen`, and `servo`. The
periodic log line shows `cross=` and `[FROZEN]`. The end report warns how many
cycles froze.

## Verify offline (no robot)
```bash
ros2 run nextup_shape_tracer validate_reference_freeze   # must print ALL PASS
```
Proves cross-track ignores phase lag (even 175° behind) and measures radial
offset exactly.

## Then on hardware
```bash
# the circle that used to spiral
ros2 launch nextup_shape_tracer shape_tracer.launch.py size:=0.15 speed:=0.015
```
Watch for `[FROZEN]` in the log — that's the reference waiting for the arm,
working as intended. It should trace a circle, not a spiral.

## CMakeLists.txt — add the new test
```cmake
add_executable(validate_reference_freeze test/validate_reference_freeze.cpp)
target_include_directories(validate_reference_freeze PUBLIC ${EIGEN3_INCLUDE_DIRS})
install(TARGETS validate_reference_freeze DESTINATION lib/${PROJECT_NAME})
```
