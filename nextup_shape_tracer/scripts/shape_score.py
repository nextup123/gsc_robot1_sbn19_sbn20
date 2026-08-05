#!/usr/bin/env python3
# =============================================================================
# shape_score.py  -  Score + plot a trace produced by shape_tracer_node.
#
# Reads the CSV (t, x_ref, y_ref, x_act, y_act, err_m) and produces:
#   * overlay plot: ideal path vs actually-traced path
#   * error-vs-time plot
#   * metrics: overall AND steady-state (after --settle seconds) mean/max/RMS,
#     plus, for circles, a best-fit-circle radius and roundness.
#
# The steady-state split matters: the tool has to reach the shape before it can
# trace it, and that approach transient is not "drawing error". Score the
# steady-state numbers when reporting achieved accuracy.
#
# Usage:
#   ros2 run nextup_shape_tracer shape_score.py trace.csv --target-radius 0.03
#   python3 shape_score.py trace.csv --settle 5 --out plot.png
# =============================================================================

import argparse
import csv
import math

import numpy as np
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def load(path):
    cols = {k: [] for k in ["t", "x_ref", "y_ref", "x_act", "y_act", "err_m"]}
    with open(path) as f:
        for row in csv.DictReader(f):
            for k in cols:
                cols[k].append(float(row[k]))
    return {k: np.array(v) for k, v in cols.items()}


def fit_circle(x, y):
    A = np.c_[2 * x, 2 * y, np.ones(len(x))]
    b = x ** 2 + y ** 2
    sol, *_ = np.linalg.lstsq(A, b, rcond=None)
    cx, cy = sol[0], sol[1]
    R = math.sqrt(sol[2] + cx ** 2 + cy ** 2)
    return cx, cy, R


def stats(err_mm, label):
    print("  %-14s mean %.3f  max %.3f  rms %.3f  std %.3f  (mm)" % (
        label, err_mm.mean(), err_mm.max(),
        math.sqrt(np.mean(err_mm ** 2)), err_mm.std()))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("csv")
    ap.add_argument("--target-radius", type=float, default=None,
                    help="compare best-fit traced radius to this (m)")
    ap.add_argument("--settle", type=float, default=None,
                    help="seconds to treat as startup transient; steady-state "
                         "metrics use samples after this. Default: auto (25%% of run).")
    ap.add_argument("--out", default="")
    args = ap.parse_args()

    d = load(args.csv)
    t = d["t"]
    err_mm = d["err_m"] * 1000.0

    settle = args.settle if args.settle is not None else (t[-1] * 0.25)
    ss = t >= settle
    xa_ss, ya_ss = d["x_act"][ss], d["y_act"][ss]

    print("\n" + "=" * 62)
    print(" TRACE SCORE: %s" % args.csv)
    print("=" * 62)
    print("  samples %d   duration %.1fs   settle cutoff %.1fs" % (len(t), t[-1], settle))
    print("-" * 62)
    stats(err_mm, "overall:")
    if ss.sum() > 1:
        stats(err_mm[ss], "steady-state:")

    # circle fit on the STEADY-STATE portion
    if ss.sum() > 5:
        try:
            cx, cy, R = fit_circle(xa_ss, ya_ss)
            print("-" * 62)
            print("  best-fit circle (steady-state actual path):")
            print("    center = (%.4f, %.4f) m    radius = %.4f m (%.2f mm)"
                  % (cx, cy, R, R * 1000))
            if args.target_radius:
                dR = (R - args.target_radius) * 1000
                print("    target %.2f mm  ->  radius error %+.3f mm"
                      % (args.target_radius * 1000, dR))
            rr = np.hypot(xa_ss - cx, ya_ss - cy)
            print("    roundness (radius std) = %.3f mm" % (rr.std() * 1000))
        except Exception:
            pass
    print("=" * 62 + "\n")

    # ---- plots ----
    fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(11, 4.6))
    ax1.plot(d["x_ref"] * 1000, d["y_ref"] * 1000, color="#2ecc71", lw=2.0,
             label="ideal", zorder=2)
    ax1.plot(d["x_act"] * 1000, d["y_act"] * 1000, color="#8e44ad", lw=1.3,
             alpha=0.9, label="actual", zorder=3)
    ax1.set_aspect("equal", "box")
    ax1.set_xlabel("X (mm)"); ax1.set_ylabel("Y (mm)")
    ax1.set_title("Ideal vs traced path"); ax1.legend(fontsize=9); ax1.grid(alpha=0.3)

    ax2.plot(t, err_mm, color="#c0392b", lw=1.0)
    ax2.axvline(settle, color="#7f8c8d", ls=":", lw=1.2, label="settle cutoff")
    if ss.sum() > 1:
        ax2.axhline(err_mm[ss].mean(), color="#e67e22", ls="--", lw=1.2,
                    label="steady mean %.2fmm" % err_mm[ss].mean())
    ax2.set_xlabel("time (s)"); ax2.set_ylabel("planar error (mm)")
    ax2.set_title("Tracking error over time"); ax2.legend(fontsize=9); ax2.grid(alpha=0.3)

    plt.tight_layout()
    out = args.out or (args.csv.rsplit(".", 1)[0] + "_score.png")
    plt.savefig(out, dpi=130)
    print("Wrote plot to %s\n" % out)


if __name__ == "__main__":
    main()
