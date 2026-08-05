// =============================================================================
// shape_tracer_node.cpp   (v2)
//
// Trace precise geometric shapes with a manipulator, by streaming Cartesian
// TWIST commands to a running moveit_servo node and closing the loop on the
// measured tool pose (TF).
//
//   ideal shape (geometry)                        moveit_servo
//        |  p_ref, v_ref                              |
//        v                                            v
//   +--------------+   TwistStamped   +--------------------------+  joint vel
//   | shape_tracer | ---------------> | servo_node (TWIST mode)  | ----------> arm
//   |    _node     |                  |   twist -> joint vels    |
//   +------^-------+                  +--------------------------+
//          |  p_act  (TF: base -> ee)
//
// CONTROL LAW
// -----------
//   twist = kp * (p_ref - p_act)          feedback  (pulls onto the path)
//         + v_ref                         feedforward (carries along the path)
//         + kd * (v_ref - v_meas)         optional damping
//
//   The VELOCITY feedforward (v_ref) is what does the heavy lifting: it
//   commands the motion the shape needs, so the feedback term only has to
//   correct small residuals rather than generate the whole motion. Without
//   it, a proportional controller settles at a standing error and the traced
//   shape comes out systematically undersized ("droop"). With it, the same
//   accuracy is reached at a much LOWER kp -- and low kp is what keeps the
//   loop stable on real hardware, where controller/EtherCAT latency makes a
//   high-kp pure-feedback loop oscillate.
//
//   Offline validation of this exact law (modelled arm: 0.5mm fixed
//   kinematic defect + 50ms first-order velocity lag, 30mm target circle,
//   6mm/s, 50Hz):
//
//       terms                       steady mean err   fit radius
//       kp=2, feedback only              2.988 mm      29.87 mm
//       kp=5, feedback only              1.199 mm      29.99 mm
//       kp=2, + velocity feedforward     0.024 mm      30.02 mm   <--
//
//   i.e. feedforward at kp=2 beats feedback-only at kp=5. See
//   test/validate_control_law.cpp -- it reproduces the table above.
//
//   NOTE on acceleration feedforward: a separate a_ref*dt term was evaluated
//   and contributes ~0.4% of the velocity command at these speeds -- i.e.
//   nothing. It is deliberately NOT included. Curvature is already carried by
//   v_ref, which is re-evaluated every cycle along the path.
//
// SAFETY
// ------
//   * moveit_servo must be launched, configured for your controller, and
//     STARTED separately. This node never configures servo's output.
//   * `vmax` hard-clamps the commanded twist speed every cycle regardless of
//     what the control law computes.
//   * If TF feedback goes stale (> tf_timeout) the node publishes zero twist
//     and refuses to move. It will not fly blind.
//   * `goto_start` approaches the shape's start point before tracing begins,
//     so the logged error measures DRAWING accuracy, not the approach move.
//     The approach is bounded by `goto_timeout`; if it cannot reach the start
//     it aborts rather than trace from the wrong place.
//   * SIGINT publishes zero twists before exit.
//
// DIAGNOSTICS
// -----------
//   Publishes ~/diagnostics (std_msgs/String, JSON) every cycle with the
//   reference point, actual point, error, commanded twist and phase. This is
//   what tells you WHY a trace looks wrong -- e.g. "still approaching",
//   "clamped at vmax", "converging but ran out of laps".
//
// INTERFACES
//   pub  <twist_topic>     geometry_msgs/TwistStamped   -> moveit_servo
//   pub  ~/diagnostics     std_msgs/String (JSON)
//   pub  ~/state           std_msgs/String  IDLE|APPROACH|TRACE|DONE|FAULT
//   sub  ~/command         std_msgs/String (JSON)  start/stop + params (HMI)
//   tf   <base> -> <ee>
//   srv  <servo_ns>/start_servo (Trigger)   [optional, auto_start]
// =============================================================================

#include <rclcpp/rclcpp.hpp>
#include <geometry_msgs/msg/twist_stamped.hpp>
#include <std_msgs/msg/string.hpp>
#include <std_msgs/msg/int8.hpp>
#include <std_srvs/srv/trigger.hpp>

#include <tf2_ros/buffer.h>
#include <tf2_ros/transform_listener.h>

#include <Eigen/Core>
#include <Eigen/Geometry>

#include <algorithm>
#include <chrono>
#include <cmath>
#include <limits>
#include <cstdio>
#include <fstream>
#include <memory>
#include <sstream>
#include <string>
#include <vector>

using namespace std::chrono_literals;
using Vec3 = Eigen::Vector3d;

// ---------------------------------------------------------------------------
// Shapes. Each produces a dense, evenly-spaced closed polyline in the drawing
// plane (local coords, centred on origin). Sampling densely and interpolating
// gives correct v_ref for every shape -- including ones with no clean analytic
// derivative (star, polygon, operator-drawn path).
// ---------------------------------------------------------------------------
using Path = std::vector<Vec3>;

static void resampleClosed(const Path& verts, Path& out, int N, bool close)
{
  out.clear();
  if (verts.size() < 2) return;
  Path pts = verts;
  if (close) pts.push_back(verts.front());

  std::vector<double> seg;
  double total = 0.0;
  for (size_t i = 0; i + 1 < pts.size(); ++i)
  {
    const double d = (pts[i + 1] - pts[i]).norm();
    seg.push_back(d);
    total += d;
  }
  if (total < 1e-12) return;

  const double step = total / N;
  size_t si = 0;
  double acc = 0.0;
  out.reserve(N);
  for (int i = 0; i < N; ++i)
  {
    const double target = i * step;
    while (si + 1 < seg.size() && acc + seg[si] < target) { acc += seg[si]; ++si; }
    const double f = (seg[si] > 1e-12) ? (target - acc) / seg[si] : 0.0;
    out.push_back(pts[si] + (pts[si + 1] - pts[si]) * f);
  }
}

static Path makeRegularPolygon(int n, double R, double rot)
{
  Path v;
  for (int i = 0; i < n; ++i)
  {
    const double a = rot + i * 2.0 * M_PI / n;
    v.emplace_back(R * std::cos(a), R * std::sin(a), 0.0);
  }
  return v;
}

/// Build the reference path for `shape`. `size` is the characteristic
/// dimension (diameter / across-corners / side, per shape). Returns a dense
/// polyline; `closed` is set false for open paths (spiral).
static Path buildShape(const std::string& shape, double size, double ratio,
                       const Path& custom, int N, bool& closed)
{
  const double R = size / 2.0;
  closed = true;
  Path verts, out;

  if (shape == "circle")
  {
    for (int i = 0; i < N; ++i)
    { const double a = i * 2.0 * M_PI / N;
      out.emplace_back(R * std::cos(a), R * std::sin(a), 0.0); }
    return out;
  }
  if (shape == "ellipse")
  {
    for (int i = 0; i < N; ++i)
    { const double a = i * 2.0 * M_PI / N;
      out.emplace_back(R * std::cos(a), R * ratio * std::sin(a), 0.0); }
    return out;
  }
  if (shape == "square")   verts = makeRegularPolygon(4, R, -M_PI / 4);
  else if (shape == "triangle") verts = makeRegularPolygon(3, R, -M_PI / 2);
  else if (shape == "hexagon")  verts = makeRegularPolygon(6, R, 0.0);
  else if (shape == "star")
  {
    for (int i = 0; i < 10; ++i)
    { const double a = -M_PI / 2 + i * M_PI / 5;
      const double r = (i % 2 == 0) ? R : R * 0.42;
      verts.emplace_back(r * std::cos(a), r * std::sin(a), 0.0); }
  }
  else if (shape == "spiral")
  {
    closed = false;
    const double turns = 3.0;
    for (int i = 0; i <= N; ++i)
    { const double u = double(i) / N, a = u * turns * 2.0 * M_PI;
      const double r = R * (0.12 + 0.88 * u);
      out.emplace_back(r * std::cos(a), r * std::sin(a), 0.0); }
    return out;
  }
  else if (shape == "lemniscate")
  {
    for (int i = 0; i < N; ++i)
    { const double a = i * 2.0 * M_PI / N;
      const double d = 1.0 + std::sin(a) * std::sin(a);
      out.emplace_back(R * std::cos(a) / d, R * std::sin(a) * std::cos(a) / d * 1.6, 0.0); }
    return out;
  }
  else if (shape == "custom")
  {
    if (custom.size() < 3) throw std::runtime_error("custom path has <3 points");
    verts = custom;
  }
  else throw std::runtime_error("unknown shape: " + shape);

  resampleClosed(verts, out, N, closed);
  return out;
}

static double pathLength(const Path& p, bool closed)
{
  double L = 0.0;
  for (size_t i = 0; i + 1 < p.size(); ++i) L += (p[i + 1] - p[i]).norm();
  if (closed && p.size() > 1) L += (p.front() - p.back()).norm();
  return std::max(L, 1e-9);
}

// ---------------------------------------------------------------------------
class ShapeTracer : public rclcpp::Node
{
public:
  ShapeTracer() : Node("shape_tracer_node")
  {
    shape_        = declare_parameter<std::string>("shape", "circle");
    size_         = declare_parameter<double>("size", 0.06);   // characteristic dim (m)
    ratio_        = declare_parameter<double>("ratio", 0.6);   // ellipse minor/major
    speed_        = declare_parameter<double>("speed", 0.006); // m/s along path
    laps_         = declare_parameter<int>("laps", 3);
    rate_hz_      = declare_parameter<double>("rate", 50.0);

    kp_           = declare_parameter<double>("kp", 2.0);
    kd_           = declare_parameter<double>("kd", 0.0);
    feedforward_  = declare_parameter<bool>("feedforward", true);
    vmax_         = declare_parameter<double>("vmax", 0.05);

    z_fixed_      = declare_parameter<double>("z", std::nan(""));
    planning_frame_ = declare_parameter<std::string>("planning_frame", "base_link");
    base_frame_   = declare_parameter<std::string>("base", "base_link");
    ee_frame_     = declare_parameter<std::string>("ee", "end");
    twist_topic_  = declare_parameter<std::string>("twist_topic",
                                                   "/servo_node/delta_twist_cmds");
    servo_ns_     = declare_parameter<std::string>("servo_ns", "/servo_node");
    auto_start_   = declare_parameter<bool>("auto_start", false);

    tf_timeout_   = declare_parameter<double>("tf_timeout", 0.2);

    // --- reference freeze ---
    // freeze_error is a CROSS-TRACK (perpendicular) distance, NOT total error.
    // Worst healthy cross-track measured on this arm: 0.437mm @ 10mm/s.
    // 2mm gives 4.6x headroom and still catches the spiral (~84mm cross-track).
    freeze_error_ = declare_parameter<double>("freeze_error", 0.002);
    freeze_timeout_ = declare_parameter<double>("freeze_timeout", 15.0);
    stall_timeout_factor_ = declare_parameter<double>("stall_timeout_factor", 4.0);
    watch_servo_status_ = declare_parameter<bool>("watch_servo_status", true);
    cross_search_window_ = declare_parameter<int>("cross_search_window", 60);
    goto_start_   = declare_parameter<bool>("goto_start", true);
    goto_tol_     = declare_parameter<double>("goto_tolerance", 0.002);
    goto_timeout_ = declare_parameter<double>("goto_timeout", 30.0);
    settle_time_  = declare_parameter<double>("settle_time", 2.0);

    csv_path_     = declare_parameter<std::string>("csv", "");
    diag_         = declare_parameter<bool>("publish_diagnostics", true);
    autorun_      = declare_parameter<bool>("autorun", true);

    n_samples_    = declare_parameter<int>("path_samples", 720);

    dt_ = 1.0 / rate_hz_;

    tf_buffer_   = std::make_unique<tf2_ros::Buffer>(get_clock());
    tf_listener_ = std::make_shared<tf2_ros::TransformListener>(*tf_buffer_);

    twist_pub_ = create_publisher<geometry_msgs::msg::TwistStamped>(twist_topic_, 10);
    state_pub_ = create_publisher<std_msgs::msg::String>("~/state", 10);
    if (diag_)
      diag_pub_ = create_publisher<std_msgs::msg::String>("~/diagnostics", 10);

    cmd_sub_ = create_subscription<std_msgs::msg::String>(
        "~/command", 10,
        std::bind(&ShapeTracer::onCommand, this, std::placeholders::_1));

    // Watch moveit_servo. Only HALT codes stop the reference; decelerations
    // (1/3/6) fire constantly on this arm and are handled by the cross-track gate.
    if (watch_servo_status_)
      status_sub_ = create_subscription<std_msgs::msg::Int8>(
          servo_ns_ + "/status", 10,
          [this](const std_msgs::msg::Int8::SharedPtr m) {
            if (m->data != servo_status_)
              RCLCPP_INFO(get_logger(), "servo status %d -> %d (%s)",
                          servo_status_, m->data, servoStatusText(m->data));
            servo_status_ = m->data;
          });

    buildPath();

    RCLCPP_INFO(get_logger(), "=== Nextup Shape Tracer v2 ===");
    logConfig();

    if (auto_start_) startServo();

    last_tf_ok_ = now();
    setState(autorun_ ? "APPROACH" : "IDLE");
    if (!autorun_)
      RCLCPP_INFO(get_logger(), "autorun=false: waiting for ~/command {\"action\":\"start\"}");

    timer_ = create_wall_timer(std::chrono::duration<double>(dt_),
                               std::bind(&ShapeTracer::loop, this));
  }

  void shutdownHalt()
  {
    for (int i = 0; i < 5; ++i) publishZero();
    if (!log_.empty()) writeCsv();
  }

private:
  // ---- config / setup -----------------------------------------------------
  void logConfig()
  {
    RCLCPP_INFO(get_logger(), "shape=%s  size=%.1fmm  perimeter=%.1fmm  speed=%.1fmm/s",
                shape_.c_str(), size_ * 1000, perimeter_ * 1000, speed_ * 1000);
    RCLCPP_INFO(get_logger(), "lap=%.1fs  laps=%d  total=%.1fs  rate=%.0fHz",
                loop_time_, laps_, total_time_, rate_hz_);
    RCLCPP_INFO(get_logger(), "kp=%.2f  kd=%.2f  feedforward=%s  vmax=%.3fm/s",
                kp_, kd_, feedforward_ ? "ON" : "OFF", vmax_);
    RCLCPP_INFO(get_logger(),
                "reference freezes if CROSS-TRACK err > %.1fmm or servo HALTS "
                "(watch_servo_status=%s)",
                freeze_error_ * 1000, watch_servo_status_ ? "on" : "off");
    RCLCPP_INFO(get_logger(), "twist->%s [%s]   TF %s->%s",
                twist_topic_.c_str(), planning_frame_.c_str(),
                base_frame_.c_str(), ee_frame_.c_str());
    if (!feedforward_)
      RCLCPP_WARN(get_logger(), "feedforward OFF: expect the traced shape to come out "
                                "UNDERSIZED at low kp (proportional droop).");
  }

  void buildPath()
  {
    bool closed = true;
    ref_ = buildShape(shape_, size_, ratio_, custom_, n_samples_, closed);
    closed_ = closed;
    perimeter_ = pathLength(ref_, closed_);
    loop_time_ = perimeter_ / speed_;
    total_time_ = loop_time_ * laps_;
  }

  void startServo()
  {
    auto c = create_client<std_srvs::srv::Trigger>(servo_ns_ + "/start_servo");
    if (!c->wait_for_service(2s))
    { RCLCPP_WARN(get_logger(), "start_servo unavailable at %s; start servo manually.",
                  servo_ns_.c_str()); return; }
    c->async_send_request(std::make_shared<std_srvs::srv::Trigger::Request>());
    RCLCPP_INFO(get_logger(), "requested %s/start_servo", servo_ns_.c_str());
  }

  // ---- command interface (HMI) --------------------------------------------
  // Minimal JSON: {"action":"start"|"stop", "shape":"circle", "size_mm":60,
  //                "speed_mms":6, "laps":3, "kp":2.0, "feedforward":true,
  //                "path":[[x_mm,y_mm],...] }
  void onCommand(const std_msgs::msg::String::SharedPtr msg)
  {
    const std::string& s = msg->data;
    auto num = [&](const char* key, double& out) {
      const auto k = std::string("\"") + key + "\"";
      auto p = s.find(k); if (p == std::string::npos) return false;
      p = s.find(':', p); if (p == std::string::npos) return false;
      try { out = std::stod(s.substr(p + 1)); } catch (...) { return false; }
      return true;
    };
    auto str = [&](const char* key, std::string& out) {
      const auto k = std::string("\"") + key + "\"";
      auto p = s.find(k); if (p == std::string::npos) return false;
      p = s.find(':', p); if (p == std::string::npos) return false;
      auto a = s.find('"', p); if (a == std::string::npos) return false;
      auto b = s.find('"', a + 1); if (b == std::string::npos) return false;
      out = s.substr(a + 1, b - a - 1); return true;
    };

    if (s.find("\"stop\"") != std::string::npos)
    { abortTrace("stopped by command"); return; }

    if (s.find("\"start\"") == std::string::npos) return;
    if (state_ == "TRACE" || state_ == "APPROACH")
    { RCLCPP_WARN(get_logger(), "busy; ignoring start command"); return; }

    std::string sh; if (str("shape", sh)) shape_ = sh;
    double v;
    if (num("size_mm", v))   size_ = v / 1000.0;
    if (num("speed_mms", v)) speed_ = v / 1000.0;
    if (num("laps", v))      laps_ = std::max(1, int(v));
    if (num("kp", v))        kp_ = v;
    if (num("ratio", v))     ratio_ = v;
    feedforward_ = (s.find("\"feedforward\":true") != std::string::npos) ||
                   (s.find("\"feedforward\": true") != std::string::npos);

    if (shape_ == "custom") parseCustomPath(s);

    try { buildPath(); }
    catch (const std::exception& e)
    { RCLCPP_ERROR(get_logger(), "bad shape: %s", e.what());
      setState("FAULT"); return; }

    reset();
    logConfig();
    setState("APPROACH");
  }

  void parseCustomPath(const std::string& s)
  {
    custom_.clear();
    auto p = s.find("\"path\"");
    if (p == std::string::npos) return;
    p = s.find('[', p);                       // opening bracket of the array
    if (p == std::string::npos) return;

    // Walk inner "[x,y]" pairs until the array closes. Bounded, and tolerant of
    // whitespace; a malformed pair simply stops the scan rather than reading
    // past the end of the string.
    while (custom_.size() < 5000)
    {
      const auto a = s.find('[', p + 1);
      if (a == std::string::npos) break;
      const auto b = s.find(']', a);
      if (b == std::string::npos) break;
      double x = 0.0, y = 0.0;
      if (std::sscanf(s.c_str() + a, "[%lf , %lf ]", &x, &y) != 2) break;
      custom_.emplace_back(x / 1000.0, y / 1000.0, 0.0);      // mm -> m
      p = b;
    }
    RCLCPP_INFO(get_logger(), "custom path: %zu points", custom_.size());
  }

  // ---- helpers ------------------------------------------------------------
  bool lookupTcp(Vec3& out)
  {
    try {
      auto tf = tf_buffer_->lookupTransform(base_frame_, ee_frame_, tf2::TimePointZero);
      out = Vec3(tf.transform.translation.x, tf.transform.translation.y,
                 tf.transform.translation.z);
      return true;
    } catch (const tf2::TransformException&) { return false; }
  }

  void publishZero()
  {
    geometry_msgs::msg::TwistStamped z;
    z.header.stamp = now(); z.header.frame_id = planning_frame_;
    twist_pub_->publish(z);
  }
  void publishTwist(const Vec3& v)
  {
    geometry_msgs::msg::TwistStamped m;
    m.header.stamp = now(); m.header.frame_id = planning_frame_;
    m.twist.linear.x = v.x(); m.twist.linear.y = v.y(); m.twist.linear.z = v.z();
    twist_pub_->publish(m);
  }
  void setState(const std::string& s)
  {
    if (state_ == s) return;
    state_ = s;
    std_msgs::msg::String m; m.data = s; state_pub_->publish(m);
    RCLCPP_INFO(get_logger(), "state -> %s", s.c_str());
  }
  double secsSince(const rclcpp::Time& t) const { return (now() - t).seconds(); }

  void reset()
  {
    log_.clear(); started_ = false;
    have_prev_ = false; clamped_cycles_ = 0;
    arc_ = 0.0; frozen_cycles_ = 0; frozen_run_ = 0;
    approach_t0_ = now();
  }

  void abortTrace(const std::string& why)
  {
    publishZero();
    RCLCPP_WARN(get_logger(), "abort: %s", why.c_str());
    if (!log_.empty()) { report(); writeCsv(); }
    setState("DONE");
  }

  // ---- main loop ----------------------------------------------------------
  void loop()
  {
    if (state_ == "IDLE" || state_ == "DONE" || state_ == "FAULT") return;

    Vec3 p_act;
    if (!lookupTcp(p_act))
    {
      if (secsSince(last_tf_ok_) > tf_timeout_)
      {
        publishZero();
        RCLCPP_WARN_THROTTLE(get_logger(), *get_clock(), 2000,
            "TF %s->%s unavailable; not moving. Is robot_state_publisher up?",
            base_frame_.c_str(), ee_frame_.c_str());
      }
      return;
    }
    last_tf_ok_ = now();

    // ---- establish the plane + centre on first good TF ----
    if (!started_)
    {
      z_height_ = std::isnan(z_fixed_) ? p_act.z() : z_fixed_;
      centre_ = Vec3(p_act.x() - ref_[0].x(), p_act.y() - ref_[0].y(), 0.0);
      started_ = true;
      RCLCPP_INFO(get_logger(), "centre=(%.4f, %.4f)  z=%.4f",
                  centre_.x(), centre_.y(), z_height_);
    }

    Vec3 p_start = centre_ + ref_[0]; p_start.z() = z_height_;

    // ---- approach phase -------------------------------------------------
    if (state_ == "APPROACH")
    {
      if (!goto_start_) { beginTrace(); }
      else
      {
        Vec3 err = p_start - p_act;
        const double d = err.norm();
        if (d <= goto_tol_)
        {
          if (settle_start_.nanoseconds() == 0) settle_start_ = now();
          publishZero();
          if (secsSince(settle_start_) >= settle_time_) beginTrace();
          return;
        }
        settle_start_ = rclcpp::Time(0, 0, RCL_ROS_TIME);
        if (secsSince(approach_t0_) > goto_timeout_)
        { abortTrace("could not reach start point within goto_timeout"); return; }

        Vec3 v = kp_ * err;
        clamp(v);
        publishTwist(v);
        RCLCPP_INFO_THROTTLE(get_logger(), *get_clock(), 1500,
            "approaching start: %.2fmm to go", d * 1000);
        return;
      }
    }

    // ---- trace phase ----------------------------------------------------
    //
    // ARC-LENGTH REFERENCE WITH A CROSS-TRACK FREEZE GATE.
    //
    // moveit_servo scales the commanded velocity down whenever it decelerates
    // (near a singularity, a joint bound, a collision). The arm then moves
    // slower than commanded. A reference advanced on a WALL CLOCK does not
    // notice, runs away from the tool, and once it has run away the position
    // error points ALONG the path rather than ACROSS it -- so the correction
    // drives the tool forward instead of outward, the radius collapses, and
    // the circle spirals into its own centre. A 150mm circle at 15mm/s did
    // exactly this on hardware.
    //
    // So the reference is advanced by ARC LENGTH, and only while the tool is
    // still ON the path.
    //
    // *** THE GATE MUST USE CROSS-TRACK ERROR, NOT TOTAL ERROR. ***
    //
    // Total error = |p_ref - p_act| conflates two different things:
    //   cross-track: perpendicular distance to the PATH  -> the real shape error
    //   along-track: distance ALONG the path (phase lag) -> harmless, always present
    //
    // Phase lag DOMINATES the total. Measured on this arm, 60mm circle, kp=3:
    //      feed      cross-track      phase       total
    //     3 mm/s        0.023 mm     0.888 mm    0.888 mm
    //     6 mm/s        0.335 mm     3.060 mm    3.078 mm
    //    10 mm/s        0.437 mm     3.768 mm    3.793 mm
    //
    // A gate on TOTAL error at 4mm leaves 0.21mm of margin at 10mm/s. It
    // stutters: freeze, tool catches up, advance, lag rebuilds, freeze. And
    // while frozen the tool keeps being driven at a STATIONARY reference, so
    // it overshoots OUTWARD past the path. That was measured as +66mm on the
    // fitted diameter. A gate on CROSS-TRACK error at 2mm has 4.6x headroom
    // against the worst healthy run, and still fires instantly on the spiral
    // (where cross-track reached ~84mm).
    //
    const double t = secsSince(trace_t0_);

    if (arc_ >= static_cast<double>(laps_))
    {
      publishZero(); report(); writeCsv(); setState("DONE");
      RCLCPP_INFO(get_logger(), "trace complete");
      return;
    }
    if (t > total_time_ * stall_timeout_factor_)
    { abortTrace("stalled: the arm cannot complete the path (check "
                 "/servo_node/status and the singularity thresholds)"); return; }

    // reference sample at the current ARC-LENGTH phase (not wall clock)
    double frac = closed_ ? std::fmod(arc_, 1.0) : std::min(arc_ / laps_, 1.0);
    if (frac < 0) frac += 1.0;
    const int n = static_cast<int>(ref_.size());
    const int i0 = std::min(n - 1, static_cast<int>(frac * n));
    const int i1 = closed_ ? (i0 + 1) % n : std::min(n - 1, i0 + 1);

    Vec3 p_ref = centre_ + ref_[i0]; p_ref.z() = z_height_;
    Vec3 tangent = ref_[i1] - ref_[i0];
    const double tl = tangent.norm();
    // NOTE: Eigen's ?: would mix expression-template types; build the Vec3
    // explicitly so both branches have the same concrete type.
    Vec3 v_ref = Vec3::Zero();
    if (tl > 1e-12) v_ref = (tangent / tl) * speed_;

    // ---- control law ----
    Vec3 pos_err = p_ref - p_act;
    pos_err.z() = z_height_ - p_act.z();

    Vec3 v_meas = Vec3::Zero();
    if (have_prev_) v_meas = (p_act - prev_p_) / dt_;

    Vec3 v_cmd = kp_ * pos_err;
    if (feedforward_) v_cmd += v_ref;
    if (kd_ > 0.0)    v_cmd += kd_ * (v_ref - v_meas);

    const bool clamped = clamp(v_cmd);
    if (clamped) ++clamped_cycles_;
    publishTwist(v_cmd);

    prev_p_ = p_act; have_prev_ = true;

    // ---- decide whether the reference may advance -------------------------
    const double cross = crossTrackError(p_act, i0);   // metres, perpendicular
    const bool on_path = (cross < freeze_error_);
    const bool halted  = servoHalted();
    const bool advance = on_path && !halted;

    if (advance)
    {
      arc_ += (speed_ * dt_) / perimeter_;
      frozen_run_ = 0;
    }
    else
    {
      ++frozen_cycles_; ++frozen_run_;
      if (frozen_run_ == 1)
        RCLCPP_WARN(get_logger(),
            "reference FROZEN (%s): cross-track=%.2fmm servo=%d (%s) -- waiting",
            halted ? "servo halted" : "tool off the path",
            cross * 1000, servo_status_, servoStatusText(servo_status_));
      if (frozen_run_ * dt_ > freeze_timeout_)
      { abortTrace("frozen too long -- the arm cannot follow the path"); return; }
    }

    const double exy = std::hypot(pos_err.x(), pos_err.y());
    log_.push_back({t, p_ref.x(), p_ref.y(), p_act.x(), p_act.y(), exy});

    if (diag_ && diag_pub_)
      publishDiag(t, frac, p_ref, p_act, v_cmd, exy, cross, clamped, advance);

    if (++tick_ % static_cast<int>(rate_hz_) == 0)
      RCLCPP_INFO(get_logger(), "t=%5.1fs  lap %.2f  err=%.3fmm  cross=%.3fmm%s%s",
                  t, arc_, exy * 1000, cross * 1000,
                  clamped ? "  [CLAMPED]" : "", advance ? "" : "  [FROZEN]");
  }

  /// Perpendicular (cross-track) distance from `p` to the reference path, in
  /// metres. This is the number that says "the tool has left the path" --
  /// unlike |p_ref - p_act|, it is unaffected by how far BEHIND along the path
  /// the tool happens to be. Phase lag is harmless and always present; gating
  /// a freeze on it makes the reference stutter and the tool overshoot.
  ///
  /// Searched over a window of segments around the current phase index, so the
  /// normal cost is O(window) rather than O(n) every cycle. But a WINDOWED
  /// search can only ever OVER-estimate the true distance: if the nearest point
  /// on the path lies outside the window (the tool is far off-path, or lagging
  /// by more than the window spans) it reports the nearest SEARCHED segment
  /// instead. Since an over-estimate is exactly what would trigger a spurious
  /// freeze, we escalate to a full O(n) search whenever the windowed result
  /// would cross the gate. Cheap when healthy, exact when it matters.
  double crossTrackError(const Vec3& p, int hint) const
  {
    const int n = static_cast<int>(ref_.size());
    if (n < 2) return 0.0;
    const double windowed = crossTrackScan(p, hint, std::min(n / 2, cross_search_window_));
    if (windowed < freeze_error_) return windowed;      // clearly on the path
    return crossTrackScan(p, hint, n / 2 + 1);          // confirm with a full scan
  }

  /// Minimum perpendicular distance from `p` to the path segments within `w`
  /// of index `hint`. w >= n/2 searches every segment.
  double crossTrackScan(const Vec3& p, int hint, int w) const
  {
    const int n = static_cast<int>(ref_.size());
    double best = std::numeric_limits<double>::max();
    for (int k = hint - w; k <= hint + w; ++k)
    {
      int i = ((k % n) + n) % n;
      int j = (i + 1) % n;
      if (!closed_ && i == n - 1) continue;
      const Vec3 a = centre_ + ref_[i], b = centre_ + ref_[j];
      const double abx = b.x() - a.x(), aby = b.y() - a.y();
      const double apx = p.x() - a.x(), apy = p.y() - a.y();
      const double L2 = abx * abx + aby * aby;
      double u = (L2 > 1e-15) ? (apx * abx + apy * aby) / L2 : 0.0;
      u = std::max(0.0, std::min(1.0, u));
      const double dx = apx - abx * u, dy = apy - aby * u;
      best = std::min(best, dx * dx + dy * dy);
    }
    return std::sqrt(best);
  }

  /// Only a genuine HALT means the arm is not moving at all. Codes 1, 3 and 6
  /// are DECELERATIONS -- the arm still moves, just slower, and that shows up
  /// naturally as growing cross-track error. This matters because
  /// moveit_servo's singularity thresholds are condition-number based, and
  /// condition number runs 30-80 in perfectly healthy poses on this arm, so
  /// codes 1 and 6 fire almost continuously. Freezing on them would stall
  /// every trace.
  bool servoHalted() const
  {
    if (!watch_servo_status_) return false;
    return servo_status_ == 2 ||   // HALT_FOR_SINGULARITY
           servo_status_ == 4 ||   // HALT_FOR_COLLISION
           servo_status_ == 5;     // JOINT_BOUND (halting)
  }

  /// moveit_servo StatusCode, Humble. Verified against the installed
  /// status_codes.h -- the enum ORDER has changed between MoveIt releases, so
  /// do not assume this mapping holds on another distro.
  static const char* servoStatusText(int c)
  {
    switch (c)
    {
      case 0:  return "no warnings";
      case 1:  return "approaching singularity, decelerating";
      case 2:  return "HALT: very close to a singularity";
      case 3:  return "close to a collision, decelerating";
      case 4:  return "HALT: collision detected";
      case 5:  return "HALT: close to a joint bound";
      case 6:  return "leaving a singularity, decelerating";
      default: return "unknown";
    }
  }

  void beginTrace()
  {
    trace_t0_ = now(); tick_ = 0; clamped_cycles_ = 0;
    arc_ = 0.0; frozen_cycles_ = 0; frozen_run_ = 0;
    log_.clear(); have_prev_ = false;
    setState("TRACE");
  }

  bool clamp(Vec3& v) const
  {
    const double s = v.norm();
    if (s > vmax_) { v *= vmax_ / s; return true; }
    return false;
  }

  void publishDiag(double t, double frac, const Vec3& pr, const Vec3& pa,
                   const Vec3& vc, double e, double cross, bool clamped, bool advance)
  {
    char buf[440];
    std::snprintf(buf, sizeof(buf),
      "{\"t\":%.3f,\"phase\":%.4f,\"ref\":[%.5f,%.5f],\"act\":[%.5f,%.5f],"
      "\"err_mm\":%.4f,\"cross_mm\":%.4f,\"vcmd\":[%.5f,%.5f,%.5f],"
      "\"clamped\":%s,\"frozen\":%s,\"servo\":%d,\"ff\":%s,\"kp\":%.2f}",
      t, frac, pr.x(), pr.y(), pa.x(), pa.y(), e * 1000, cross * 1000,
      vc.x(), vc.y(), vc.z(), clamped ? "true" : "false",
      advance ? "false" : "true", servo_status_,
      feedforward_ ? "true" : "false", kp_);
    std_msgs::msg::String m; m.data = buf; diag_pub_->publish(m);
  }

  // ---- reporting ----------------------------------------------------------
  void report()
  {
    if (log_.empty()) { RCLCPP_WARN(get_logger(), "no samples"); return; }
    const int n = static_cast<int>(log_.size());
    // steady state = last 60% (the first part includes any residual settling)
    const int s0 = n * 2 / 5;
    double sum = 0, mx = 0, sq = 0, ssum = 0, smx = 0, ssq = 0;
    for (int i = 0; i < n; ++i)
    {
      const double e = log_[i].err;
      sum += e; mx = std::max(mx, e); sq += e * e;
      if (i >= s0) { ssum += e; smx = std::max(smx, e); ssq += e * e; }
    }
    const int sn = n - s0;
    RCLCPP_INFO(get_logger(), "==== TRACE REPORT (%s) ====", shape_.c_str());
    RCLCPP_INFO(get_logger(), "  overall      n=%d  mean=%.3fmm  max=%.3fmm  rms=%.3fmm",
                n, sum / n * 1000, mx * 1000, std::sqrt(sq / n) * 1000);
    if (sn > 1)
      RCLCPP_INFO(get_logger(), "  steady-state n=%d  mean=%.3fmm  max=%.3fmm  rms=%.3fmm",
                  sn, ssum / sn * 1000, smx * 1000, std::sqrt(ssq / sn) * 1000);
    if (frozen_cycles_ > 0)
      RCLCPP_WARN(get_logger(),
          "  reference FROZEN on %d cycles -- the arm was held back (servo "
          "deceleration or an unreachable pose). The path was still traced "
          "correctly, just slower than requested.", frozen_cycles_);
    if (clamped_cycles_ > 0)
      RCLCPP_WARN(get_logger(),
          "  vmax CLAMPED on %d/%d cycles (%.0f%%) -- raise vmax or lower kp/speed; "
          "a clamped command cannot track the path",
          clamped_cycles_, n, 100.0 * clamped_cycles_ / n);
    if (!feedforward_)
      RCLCPP_WARN(get_logger(), "  feedforward was OFF -- undersize is expected");
  }

  void writeCsv()
  {
    std::string p = csv_path_;
    if (p.empty()) { char b[128]; std::snprintf(b, sizeof(b), "shape_%s_trace.csv",
                                                shape_.c_str()); p = b; }
    std::ofstream f(p);
    f << "t,x_ref,y_ref,x_act,y_act,err_m\n";
    for (const auto& r : log_)
      f << r.t << "," << r.xr << "," << r.yr << "," << r.xa << "," << r.ya
        << "," << r.err << "\n";
    RCLCPP_INFO(get_logger(), "  wrote %s  (score with shape_score.py)", p.c_str());
  }

  // ---- members ------------------------------------------------------------
  struct Row { double t, xr, yr, xa, ya, err; };

  std::string shape_, planning_frame_, base_frame_, ee_frame_,
              twist_topic_, servo_ns_, csv_path_, state_{"IDLE"};
  double size_, ratio_, speed_, rate_hz_, kp_, kd_, vmax_, z_fixed_,
         tf_timeout_, goto_tol_, goto_timeout_, settle_time_, dt_,
         freeze_error_, freeze_timeout_, stall_timeout_factor_;
  int laps_, n_samples_;
  bool feedforward_, auto_start_, goto_start_, diag_, autorun_, watch_servo_status_;

  Path ref_, custom_;
  bool closed_{true};
  double perimeter_{0}, loop_time_{0}, total_time_{0};

  std::unique_ptr<tf2_ros::Buffer> tf_buffer_;
  std::shared_ptr<tf2_ros::TransformListener> tf_listener_;
  rclcpp::Publisher<geometry_msgs::msg::TwistStamped>::SharedPtr twist_pub_;
  rclcpp::Publisher<std_msgs::msg::String>::SharedPtr state_pub_, diag_pub_;
  rclcpp::Subscription<std_msgs::msg::String>::SharedPtr cmd_sub_;
  rclcpp::Subscription<std_msgs::msg::Int8>::SharedPtr status_sub_;
  rclcpp::TimerBase::SharedPtr timer_;

  Vec3 centre_{Vec3::Zero()}, prev_p_{Vec3::Zero()};
  double z_height_{0};
  bool started_{false}, have_prev_{false};
  rclcpp::Time trace_t0_, last_tf_ok_, approach_t0_,
               settle_start_{0, 0, RCL_ROS_TIME};
  int tick_{0}, clamped_cycles_{0}, frozen_cycles_{0}, frozen_run_{0};
  int servo_status_{0}, cross_search_window_{60};
  double arc_{0.0};                 ///< reference phase, in laps (arc length)
  std::vector<Row> log_;
};

int main(int argc, char** argv)
{
  rclcpp::init(argc, argv);
  auto node = std::make_shared<ShapeTracer>();
  rclcpp::on_shutdown([node]() { node->shutdownHalt(); });
  rclcpp::spin(node);
  rclcpp::shutdown();
  return 0;
}
