// =============================================================================
// validate_control_law.cpp
//
// Reproduces the control-law comparison table quoted in shape_tracer_node.cpp.
// No ROS required -- this is pure maths against a modelled arm, so it can be
// run anywhere to check the claim that VELOCITY FEEDFORWARD lets a low (and
// therefore hardware-safe) gain reach the accuracy of a high gain.
//
// Arm model:
//   * fixed kinematic offset of ~0.5 mm  (the manufacturing defect)
//   * first-order velocity lag, tau = 50 ms  (drive dynamics)
//   * the controller only ever sees the OFFSET position, as a real
//     forward-kinematics reading would.
//
// Build & run:
//     g++ -O2 -I/usr/include/eigen3 validate_control_law.cpp -o validate
//     ./validate
//
// Expected (30 mm target radius, 6 mm/s, 50 Hz, steady state = last 50%):
//
//     terms                        mean_err    fit_R
//     kp=2  feedback only           ~2.99mm   ~29.87mm    <- droop: undersized
//     kp=5  feedback only           ~1.20mm   ~29.99mm
//     kp=2  + velocity FF           ~0.02mm   ~30.02mm    <- the point
//     kp=2  + vel FF + accel*dt     ~0.01mm   ~30.01mm    <- accel adds ~nothing
//
// Conclusion: the velocity feedforward carries the motion; the acceleration
// term contributes ~0.4% of the command at these speeds and is intentionally
// omitted from the node. Feedforward at kp=2 beats feedback-only at kp=5.
// =============================================================================

#include <Eigen/Dense>
#include <cmath>
#include <cstdio>
#include <vector>

using Vec3 = Eigen::Vector3d;

struct Result { double mean_mm; double fit_R_mm; };

static Result run(double kp, bool use_vff, bool use_aff,
                  double radius = 0.03, double speed = 0.006,
                  double rate = 50.0, int laps = 4)
{
  const double dt = 1.0 / rate;
  const double perim = 2.0 * M_PI * radius;
  const double loopT = perim / speed;
  const double total = loopT * laps;

  const double tau = 0.05;                  // drive velocity lag
  const Vec3 bias(0.0004, -0.0003, 0.0);    // fixed kinematic defect

  Vec3 p(radius, 0.0, 0.0), v = Vec3::Zero();
  std::vector<double> errs;
  std::vector<Vec3> acts;

  for (double t = 0.0; t < total; t += dt)
  {
    const double s  = std::fmod(t / loopT, 1.0);
    const double th = 2.0 * M_PI * s;
    const double w  = speed / radius;

    const Vec3 p_ref(radius * std::cos(th), radius * std::sin(th), 0.0);
    const Vec3 v_ref(-radius * std::sin(th) * w, radius * std::cos(th) * w, 0.0);
    const Vec3 a_ref(-radius * std::cos(th) * w * w,
                     -radius * std::sin(th) * w * w, 0.0);

    const Vec3 p_meas = p + bias;           // what FK/TF would report
    const Vec3 err    = p_ref - p_meas;

    Vec3 v_cmd = kp * err;                  // feedback
    if (use_vff) v_cmd += v_ref;            // velocity feedforward
    if (use_aff) v_cmd += a_ref * dt;       // acceleration feedforward

    const double sp = v_cmd.norm();
    if (sp > 0.05) v_cmd *= 0.05 / sp;      // vmax clamp

    v += (v_cmd - v) * (dt / tau);          // arm lag
    p += v * dt;

    if (t > total * 0.5)                    // steady state only
    {
      errs.push_back(std::hypot(err.x(), err.y()));
      acts.push_back(p + bias);
    }
  }

  double sum = 0.0;
  for (double e : errs) sum += e;

  // algebraic circle fit of the traced path
  const int n = static_cast<int>(acts.size());
  Eigen::MatrixXd A(n, 3);
  Eigen::VectorXd b(n);
  for (int i = 0; i < n; ++i)
  {
    A(i, 0) = 2 * acts[i].x();
    A(i, 1) = 2 * acts[i].y();
    A(i, 2) = 1.0;
    b(i) = acts[i].x() * acts[i].x() + acts[i].y() * acts[i].y();
  }
  const Eigen::Vector3d sol = A.colPivHouseholderQr().solve(b);
  const double R = std::sqrt(sol(2) + sol(0) * sol(0) + sol(1) * sol(1));

  return { sum / errs.size() * 1000.0, R * 1000.0 };
}

int main()
{
  std::printf("Nextup shape tracer -- control law validation\n");
  std::printf("arm: 0.5mm fixed defect, 50ms velocity lag\n");
  std::printf("path: 30.00mm radius circle, 6mm/s, 50Hz, steady state\n\n");
  std::printf("%-34s %10s %10s\n", "terms", "mean_err", "fit_R");
  std::printf("%-34s %10s %10s\n", "-----", "--------", "-----");

  struct Case { double kp; bool vff, aff; const char* name; };
  const Case cases[] = {
    {2.0, false, false, "kp=2  feedback only"},
    {5.0, false, false, "kp=5  feedback only"},
    {2.0, true,  false, "kp=2  + velocity FF"},
    {2.0, true,  true,  "kp=2  + vel FF + accel*dt"},
    {3.0, true,  false, "kp=3  + velocity FF"},
  };

  for (const auto& c : cases)
  {
    const Result r = run(c.kp, c.vff, c.aff);
    std::printf("%-34s %8.3fmm %8.2fmm\n", c.name, r.mean_mm, r.fit_R_mm);
  }

  std::printf("\nRead: feedforward at kp=2 matches or beats feedback-only at kp=5.\n");
  std::printf("Low kp is what keeps the loop stable on real hardware.\n");
  std::printf("The accel*dt term contributes ~0.4%% of the command -- omitted.\n");
  return 0;
}
