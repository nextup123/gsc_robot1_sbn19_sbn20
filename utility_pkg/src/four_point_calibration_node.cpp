#include <rclcpp/rclcpp.hpp>
#include <std_msgs/msg/string.hpp>
#include <std_msgs/msg/bool.hpp>
#include <sensor_msgs/msg/joint_state.hpp>

#include <moveit/move_group_interface/move_group_interface.h>

#include <tf2/LinearMath/Quaternion.h>
#include <tf2/LinearMath/Matrix3x3.h>
#include <tf2/LinearMath/Vector3.h>
#include <tf2_geometry_msgs/tf2_geometry_msgs.hpp>
#include <yaml-cpp/yaml.h>

#include <fstream>
#include <sstream>
#include <string>
#include <vector>
#include <mutex>
#include <ctime>
#include <cmath>
#include <thread>
#include <unistd.h>

// =============================================================================
//  calibration_ws_tf_node
//
//  Command-driven workspace-TF calibration. Replaces the old file-watcher.
//
//  FLOW (driven by topics, expected serial):
//    1. /start_calibration  (std_msgs/String)
//         - frame name -> looked up in calibration.yaml
//         - four-point TF computed (same math as before), held in memory
//         - status published to /bt_toast_popup : "tf calibration done"
//    2. /go_to_frame_origin (std_msgs/String)
//         - frame name -> PTP the TCP to that frame's COMPUTED TF position.
//           ORIENTATION-FREE: position only. The wrist keeps its CURRENT
//           orientation so the tool does not twist into the workspace.
//    3. /finish_ws_tf       (std_msgs/Bool)
//         - on true: append a new point to points.yaml with
//             coordinate    = the computed TF pose (cm + deg)
//             joints_values = live /joint_states captured at this instant
//             is_tf: true, is_tf_calibrated: true, is_editable: false
//         - existing points in points.yaml are left untouched
//
//  UNITS
//    calibration.yaml points : xyz in cm, rpy in degrees.
//    geometry (internal)     : metres / radians.
//    MoveIt target pose      : metres / quaternion.
//    points.yaml coordinate  : xyz in cm, rpy(=r/p/w) in degrees.
//
//  MOTION (Option A): this node owns a single MoveGroupInterface on its own
//  MultiThreaded executor (same hardened pattern used elsewhere in the stack
//  to avoid stale CurrentStateMonitor). Pilz PTP at a safe scaling.
//
//  NOTE ON /go_to_frame_origin ORIENTATION
//    The stored TF carries a full orientation (the plane's RPY), but driving
//    to that orientation can tip the tool into the surface. So for the GOTO we
//    deliberately DISCARD the computed orientation and reuse the robot's
//    current TCP orientation as the goal. We still build a FULL pose target
//    (position + current orientation) rather than a bare position target,
//    because Pilz PTP wants a fully-defined goal and gets flaky with an
//    under-constrained one. The computed orientation is still saved to
//    points.yaml unchanged on /finish_ws_tf.
// =============================================================================

static constexpr double CM_PER_M    = 100.0;
static constexpr double DEG_PER_RAD = 180.0 / M_PI;

class CalibrationWsTfNode : public rclcpp::Node
{
public:
  CalibrationWsTfNode()
  : Node("calibration_ws_tf_node")
  {
    this->declare_parameter<std::string>(
      "calibration_yaml",
      "/home/nextup/NextupRobot/src/active_project_configs/planning_data/calibration.yaml");
    this->declare_parameter<std::string>(
      "points_yaml",
      "/home/nextup/NextupRobot/src/active_project_configs/planning_data/points.yaml");

    this->declare_parameter<std::string>("planning_group", "robot_manipulator");
    this->declare_parameter<std::string>("joint_states_topic", "/joint_states");

    // Pilz PTP scaling (safe default, matches homing-node posture).
    this->declare_parameter<double>("velocity_scaling", 0.05);
    this->declare_parameter<double>("acceleration_scaling", 0.05);
    this->declare_parameter<double>("planning_time", 5.0);

    // Perpendicular distance (m) point4 may sit off the P1-P2-P3 plane
    // before the frame is flagged SUSPECT. 5 mm default.
    this->declare_parameter<double>("point4_plane_tolerance_m", 0.005);

    // Flip computed Z up when the raw plane normal points down (flat-surface teach).
    this->declare_parameter<bool>("enforce_z_up", true);

    calibration_yaml_ = this->get_parameter("calibration_yaml").as_string();
    points_yaml_      = this->get_parameter("points_yaml").as_string();
    planning_group_   = this->get_parameter("planning_group").as_string();
    const std::string js_topic = this->get_parameter("joint_states_topic").as_string();
    vel_scale_  = this->get_parameter("velocity_scaling").as_double();
    acc_scale_  = this->get_parameter("acceleration_scaling").as_double();
    plan_time_  = this->get_parameter("planning_time").as_double();
    point4_plane_tolerance_m_ = this->get_parameter("point4_plane_tolerance_m").as_double();
    enforce_z_up_ = this->get_parameter("enforce_z_up").as_bool();

    // --- toast publisher ---
    toast_pub_ = this->create_publisher<std_msgs::msg::String>("/bt_toast_popup", 10);

    // --- joint_states cache ---
    auto js_qos = rclcpp::SensorDataQoS();
    js_sub_ = this->create_subscription<sensor_msgs::msg::JointState>(
      js_topic, js_qos,
      std::bind(&CalibrationWsTfNode::onJointStates, this, std::placeholders::_1));

    // --- command subscriptions ---
    start_sub_ = this->create_subscription<std_msgs::msg::String>(
      "/start_calibration", 10,
      std::bind(&CalibrationWsTfNode::onStartCalibration, this, std::placeholders::_1));

    goto_sub_ = this->create_subscription<std_msgs::msg::String>(
      "/go_to_frame_origin", 10,
      std::bind(&CalibrationWsTfNode::onGoToFrameOrigin, this, std::placeholders::_1));

    finish_sub_ = this->create_subscription<std_msgs::msg::Bool>(
      "/finish_ws_calibration", 10,
      std::bind(&CalibrationWsTfNode::onFinishWsTf, this, std::placeholders::_1));

    RCLCPP_INFO(this->get_logger(),
      "calibration_ws_tf_node up.\n  calib: %s\n  points: %s\n  group: %s",
      calibration_yaml_.c_str(), points_yaml_.c_str(), planning_group_.c_str());
  }

  // MoveGroup must be created AFTER the node is owned by a shared_ptr, so this
  // is called once from main() after construction, before spinning.
  void initMoveGroup()
  {
    using moveit::planning_interface::MoveGroupInterface;
    move_group_ = std::make_shared<MoveGroupInterface>(
      shared_from_this(), planning_group_);

    move_group_->setPlanningPipelineId("pilz_industrial_motion_planner");
    move_group_->setPlannerId("PTP");
    move_group_->setMaxVelocityScalingFactor(vel_scale_);
    move_group_->setMaxAccelerationScalingFactor(acc_scale_);
    move_group_->setPlanningTime(plan_time_);

    RCLCPP_INFO(this->get_logger(),
      "MoveGroup ready. EEF link: %s, planning frame: %s",
      move_group_->getEndEffectorLink().c_str(),
      move_group_->getPlanningFrame().c_str());
  }

private:
  struct PoseRPY { double x{0}, y{0}, z{0}, roll{0}, pitch{0}, yaw{0}; }; // cm + deg

  // ------------------------------------------------------------------
  // /joint_states cache (latest snapshot, name->position)
  // ------------------------------------------------------------------
  void onJointStates(const sensor_msgs::msg::JointState::SharedPtr msg)
  {
    std::lock_guard<std::mutex> lk(js_mutex_);
    last_joint_names_ = msg->name;
    last_joint_positions_ = msg->position;
    have_joint_states_ = true;
  }

  // ------------------------------------------------------------------
  // 1) /start_calibration : compute TF for the named frame, hold it, toast.
  // ------------------------------------------------------------------
  void onStartCalibration(const std_msgs::msg::String::SharedPtr msg)
  {
    const std::string frame_name = msg->data;
    RCLCPP_INFO(this->get_logger(), "[/start_calibration] frame='%s'", frame_name.c_str());

    YAML::Node root;
    try {
      root = YAML::LoadFile(calibration_yaml_);
    } catch (const std::exception & e) {
      RCLCPP_ERROR(this->get_logger(), "Failed to load %s: %s",
        calibration_yaml_.c_str(), e.what());
      toast("calibration failed: cannot read calibration file");
      return;
    }

    if (!root.IsMap() || !root[frame_name]) {
      RCLCPP_ERROR(this->get_logger(), "Frame '%s' not found in %s",
        frame_name.c_str(), calibration_yaml_.c_str());
      toast("calibration failed: frame '" + frame_name + "' not found");
      return;
    }

    const YAML::Node frame = root[frame_name];
    for (int p = 1; p <= 4; ++p) {
      if (!frame["point" + std::to_string(p)]) {
        RCLCPP_ERROR(this->get_logger(),
          "Frame '%s' missing point%d -> need all 4.", frame_name.c_str(), p);
        toast("calibration failed: '" + frame_name + "' needs 4 points");
        return;
      }
    }

    PoseRPY tf;
    if (!computeFrameTf(frame_name, frame, tf)) {
      toast("calibration failed: degenerate points for '" + frame_name + "'");
      return;
    }

    {
      std::lock_guard<std::mutex> lk(tf_mutex_);
      active_frame_name_ = frame_name;
      active_tf_ = tf;
      have_active_tf_ = true;
    }

    RCLCPP_INFO(this->get_logger(),
      "Computed TF for '%s': xyz(cm)=[%.2f %.2f %.2f] rpy(deg)=[%.2f %.2f %.2f]",
      frame_name.c_str(), tf.x, tf.y, tf.z, tf.roll, tf.pitch, tf.yaw);

    toast("tf calibration done");
  }

  // ------------------------------------------------------------------
  // 2) /go_to_frame_origin : PTP to the computed TF POSITION of the named
  //    frame, keeping the robot's CURRENT orientation.
  //
  //    We do NOT use the computed plane orientation here -- matching it can
  //    tilt the tool into the surface. Position is taken from the stored TF;
  //    orientation is read live from getCurrentPose() so the wrist stays put.
  // ------------------------------------------------------------------
  void onGoToFrameOrigin(const std_msgs::msg::String::SharedPtr msg)
  {
    const std::string frame_name = msg->data;
    RCLCPP_INFO(this->get_logger(), "[/go_to_frame_origin] frame='%s'", frame_name.c_str());

    if (busy_.exchange(true)) {
      RCLCPP_WARN(this->get_logger(), "Motion already in progress; ignoring command.");
      return;
    }
    struct BusyGuard { std::atomic<bool> & b; ~BusyGuard(){ b.store(false); } } guard{busy_};

    PoseRPY tf;
    {
      std::lock_guard<std::mutex> lk(tf_mutex_);
      if (!have_active_tf_ || active_frame_name_ != frame_name) {
        RCLCPP_ERROR(this->get_logger(),
          "No computed TF for '%s'. Run /start_calibration for it first.",
          frame_name.c_str());
        toast("go_to_frame failed: run /start_calibration for '" + frame_name + "' first");
        return;
      }
      tf = active_tf_;
    }

    // Grab the robot's current TCP orientation. This is what we'll keep.
    geometry_msgs::msg::PoseStamped current = move_group_->getCurrentPose();

    // Build target pose:
    //   position    -> stored TF (cm -> m)
    //   orientation -> CURRENT wrist orientation (unchanged)
    geometry_msgs::msg::Pose target;
    target.position.x = tf.x / CM_PER_M;
    target.position.y = tf.y / CM_PER_M;
    target.position.z = tf.z / CM_PER_M;
    target.orientation = current.pose.orientation;

    RCLCPP_INFO(this->get_logger(),
      "GOTO '%s' position-only: xyz(m)=[%.4f %.4f %.4f], keeping current orientation "
      "[%.4f %.4f %.4f %.4f].",
      frame_name.c_str(),
      target.position.x, target.position.y, target.position.z,
      target.orientation.x, target.orientation.y,
      target.orientation.z, target.orientation.w);

    move_group_->setPlannerId("PTP");
    move_group_->setPoseTarget(target);

    moveit::planning_interface::MoveGroupInterface::Plan plan;
    auto pr = move_group_->plan(plan);
    if (pr != moveit::core::MoveItErrorCode::SUCCESS) {
      RCLCPP_ERROR(this->get_logger(), "Planning to '%s' position FAILED (code %d).",
        frame_name.c_str(), pr.val);
      toast("go_to_frame failed: planning error for '" + frame_name + "'");
      return;
    }

    auto er = move_group_->execute(plan);
    if (er != moveit::core::MoveItErrorCode::SUCCESS) {
      RCLCPP_ERROR(this->get_logger(), "Execution to '%s' position FAILED (code %d).",
        frame_name.c_str(), er.val);
      toast("go_to_frame failed: execution error for '" + frame_name + "'");
      return;
    }

    RCLCPP_INFO(this->get_logger(), "Reached position of '%s'.", frame_name.c_str());
    toast("reached frame origin: " + frame_name);
  }

  // ------------------------------------------------------------------
  // 3) /finish_ws_tf : on true, append point to points.yaml.
  // ------------------------------------------------------------------
  void onFinishWsTf(const std_msgs::msg::Bool::SharedPtr msg)
  {
    if (!msg->data) {
      RCLCPP_INFO(this->get_logger(), "[/finish_ws_tf] false -> ignored.");
      return;
    }
    RCLCPP_INFO(this->get_logger(), "[/finish_ws_tf] true -> saving point.");

    PoseRPY tf;
    std::string frame_name;
    {
      std::lock_guard<std::mutex> lk(tf_mutex_);
      if (!have_active_tf_) {
        RCLCPP_ERROR(this->get_logger(), "No computed TF to save.");
        toast("save failed: no active calibration");
        return;
      }
      tf = active_tf_;
      frame_name = active_frame_name_;
    }

    std::vector<std::string> jnames;
    std::vector<double> jpos;
    {
      std::lock_guard<std::mutex> lk(js_mutex_);
      if (!have_joint_states_) {
        RCLCPP_ERROR(this->get_logger(), "No /joint_states received yet; cannot save joints.");
        toast("save failed: no joint_states");
        return;
      }
      jnames = last_joint_names_;
      jpos   = last_joint_positions_;
    }

    if (!appendPointToYaml(frame_name, tf, jnames, jpos)) {
      toast("save failed: could not write points.yaml");
      return;
    }

    RCLCPP_INFO(this->get_logger(), "Saved '%s' to %s.",
      frame_name.c_str(), points_yaml_.c_str());
    toast("ws tf saved: " + frame_name);
  }

  // ------------------------------------------------------------------
  // Four-point frame math (unchanged): cm in -> cm/deg out.
  //   point1 = origin
  //   X = P1 -> P2 ; Z = X x (P1->P3) ; Y = Z x X
  //   point4 = off-plane witness (error check only)
  // ------------------------------------------------------------------
  bool computeFrameTf(const std::string & frame_name,
                      const YAML::Node & frame,
                      PoseRPY & out_tf)
  {
    tf2::Vector3 p1 = readPointMeters(frame["point1"]);
    tf2::Vector3 p2 = readPointMeters(frame["point2"]);
    tf2::Vector3 p3 = readPointMeters(frame["point3"]);
    tf2::Vector3 p4 = readPointMeters(frame["point4"]);

    tf2::Vector3 x_axis = (p2 - p1);
    if (x_axis.length() < 1e-9) {
      RCLCPP_ERROR(this->get_logger(),
        "  '%s': point1 == point2, cannot form X axis.", frame_name.c_str());
      return false;
    }
    x_axis.normalize();

    tf2::Vector3 v = (p3 - p1);
    tf2::Vector3 z_axis = x_axis.cross(v);
    if (z_axis.length() < 1e-9) {
      RCLCPP_ERROR(this->get_logger(),
        "  '%s': point3 collinear with point1-point2, no plane normal.", frame_name.c_str());
      return false;
    }
    z_axis.normalize();

    if (enforce_z_up_ && z_axis.z() < 0.0) {
      z_axis = -z_axis;
      RCLCPP_INFO(this->get_logger(),
        "  '%s': raw plane normal pointed down; flipped Z up.", frame_name.c_str());
    }

    tf2::Vector3 y_axis = z_axis.cross(x_axis);
    y_axis.normalize();

    tf2::Matrix3x3 rot(
      x_axis.x(), y_axis.x(), z_axis.x(),
      x_axis.y(), y_axis.y(), z_axis.y(),
      x_axis.z(), y_axis.z(), z_axis.z());

    double roll, pitch, yaw;
    rot.getRPY(roll, pitch, yaw);

    double plane_dist = (p4 - p1).dot(z_axis);
    double abs_mm = std::fabs(plane_dist) * 1000.0;
    if (abs_mm <= point4_plane_tolerance_m_ * 1000.0) {
      RCLCPP_INFO(this->get_logger(),
        "  '%s': point4 %.2f mm off-plane (tol %.2f mm) -> PASS.",
        frame_name.c_str(), abs_mm, point4_plane_tolerance_m_ * 1000.0);
    } else {
      RCLCPP_WARN(this->get_logger(),
        "  '%s': point4 %.2f mm off-plane (tol %.2f mm) -> SUSPECT, re-teach.",
        frame_name.c_str(), abs_mm, point4_plane_tolerance_m_ * 1000.0);
    }

    out_tf.x = p1.x() * CM_PER_M;
    out_tf.y = p1.y() * CM_PER_M;
    out_tf.z = p1.z() * CM_PER_M;
    out_tf.roll  = roll  * DEG_PER_RAD;
    out_tf.pitch = pitch * DEG_PER_RAD;
    out_tf.yaw   = yaw   * DEG_PER_RAD;
    return true;
  }

  tf2::Vector3 readPointMeters(const YAML::Node & pt)
  {
    return tf2::Vector3(
      pt["x"].as<double>() / CM_PER_M,
      pt["y"].as<double>() / CM_PER_M,
      pt["z"].as<double>() / CM_PER_M);
  }

  // ------------------------------------------------------------------
  // Append one point to points.yaml's `points:` list WITHOUT disturbing the
  // rest of the file. We load the existing doc, push a new map onto points,
  // and atomic-write the whole thing back.
  // ------------------------------------------------------------------
  bool appendPointToYaml(const std::string & frame_name,
                         const PoseRPY & tf,
                         const std::vector<std::string> & jnames,
                         const std::vector<double> & jpos)
  {
    YAML::Node root;
    try {
      root = YAML::LoadFile(points_yaml_);
    } catch (const std::exception & e) {
      RCLCPP_ERROR(this->get_logger(), "Failed to load %s: %s",
        points_yaml_.c_str(), e.what());
      return false;
    }

    if (!root["points"] || !root["points"].IsSequence()) {
      RCLCPP_ERROR(this->get_logger(),
        "%s has no 'points:' sequence; refusing to write.", points_yaml_.c_str());
      return false;
    }

    // joints_values: map joint1..joint6 from the live /joint_states snapshot.
    // We pull by name so ordering in /joint_states doesn't scramble anything.
    YAML::Node jv(YAML::NodeType::Map);
    for (int i = 1; i <= 6; ++i) {
      const std::string jn = "joint" + std::to_string(i);
      double val = 0.0;
      bool found = false;
      for (size_t k = 0; k < jnames.size() && k < jpos.size(); ++k) {
        if (jnames[k] == jn) { val = jpos[k]; found = true; break; }
      }
      if (!found) {
        RCLCPP_WARN(this->get_logger(),
          "joint '%s' not in /joint_states; writing 0.0.", jn.c_str());
      }
      jv[jn] = val;
    }

    YAML::Node coord(YAML::NodeType::Map);
    coord["x"] = tf.x;   coord["y"] = tf.y;   coord["z"] = tf.z;     // cm
    coord["r"] = tf.roll; coord["p"] = tf.pitch; coord["w"] = tf.yaw; // deg

    YAML::Node pt(YAML::NodeType::Map);
    pt["name"]             = frame_name;
    pt["date_time"]        = nowStamp();
    pt["sequence"]         = 1;
    pt["nature"]           = std::string("ws_calib");
    pt["is_tf"]            = true;
    pt["is_tf_calibrated"] = true;
    pt["is_editable"]      = false;
    pt["joints_values"]    = jv;
    pt["coordinate"]       = coord;

    root["points"].push_back(pt);

    return writeYamlAtomic(root);
  }

  // 19jun_1408-style stamp (DDmon_HHMM), matching existing entries.
  std::string nowStamp()
  {
    std::time_t t = std::time(nullptr);
    std::tm lt{};
    localtime_r(&t, &lt);
    static const char * mon[] =
      {"jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"};
    char buf[32];
    std::snprintf(buf, sizeof(buf), "%02d%s_%02d%02d",
      lt.tm_mday, mon[lt.tm_mon], lt.tm_hour, lt.tm_min);
    return std::string(buf);
  }

  bool writeYamlAtomic(const YAML::Node & root)
  {
    const std::string tmp = points_yaml_ + ".tmp";
    {
      std::ofstream fout(tmp);
      if (!fout.is_open()) {
        RCLCPP_ERROR(this->get_logger(), "Cannot open %s for writing.", tmp.c_str());
        return false;
      }
      fout << root;
      fout.flush();
      fout.close();
    }
    // fsync the dir entry via rename (tmp and target are in the same folder).
    if (std::rename(tmp.c_str(), points_yaml_.c_str()) != 0) {
      RCLCPP_ERROR(this->get_logger(), "Failed to rename %s -> %s",
        tmp.c_str(), points_yaml_.c_str());
      return false;
    }
    return true;
  }

  void toast(const std::string & text)
  {
    std_msgs::msg::String m;
    m.data = text;
    toast_pub_->publish(m);
  }

  // ---- params ----
  std::string calibration_yaml_, points_yaml_, planning_group_;
  double vel_scale_{0.05}, acc_scale_{0.05}, plan_time_{5.0};
  double point4_plane_tolerance_m_{0.005};
  bool   enforce_z_up_{true};

  // ---- pubs/subs ----
  rclcpp::Publisher<std_msgs::msg::String>::SharedPtr toast_pub_;
  rclcpp::Subscription<sensor_msgs::msg::JointState>::SharedPtr js_sub_;
  rclcpp::Subscription<std_msgs::msg::String>::SharedPtr start_sub_;
  rclcpp::Subscription<std_msgs::msg::String>::SharedPtr goto_sub_;
  rclcpp::Subscription<std_msgs::msg::Bool>::SharedPtr finish_sub_;

  // ---- MoveGroup ----
  std::shared_ptr<moveit::planning_interface::MoveGroupInterface> move_group_;

  // ---- active computed TF ----
  std::mutex tf_mutex_;
  std::string active_frame_name_;
  PoseRPY active_tf_;
  bool have_active_tf_{false};

  // ---- joint_states cache ----
  std::mutex js_mutex_;
  std::vector<std::string> last_joint_names_;
  std::vector<double> last_joint_positions_;
  bool have_joint_states_{false};

  std::atomic<bool> busy_{false};
};

int main(int argc, char ** argv)
{
  rclcpp::init(argc, argv);

  auto node = std::make_shared<CalibrationWsTfNode>();
  node->initMoveGroup();   // must run after shared_ptr exists (shared_from_this)

  // MoveGroupInterface needs a spinning executor for its CurrentStateMonitor /
  // action callbacks. MultiThreaded so the move's action feedback doesn't
  // deadlock against our own command callbacks.
  rclcpp::executors::MultiThreadedExecutor exec;
  exec.add_node(node);
  exec.spin();

  rclcpp::shutdown();
  return 0;
}