// backend/ros/LightweightROSBridge.js
import rclnodejs from 'rclnodejs';
import fs from 'fs';
import path from 'path';
import { saveLogMessage, saveLiveLog } from './rosHelper.js';
import { detectCurrentMode, applyOverspeedOnly } from './modeOverspeed.js';

// Simple constants

// The robot boots in jog (mode 9). Wait this long after init before writing
// the jog overspeed profile, so the EtherCAT manager's SDO services are up.
const STARTUP_OVERSPEED_DELAY_MS = 3000;

const ROS_TOPICS = {
  CMD_VEL: '/cmd_vel',
  SERVO_TWIST: '/servo_node/delta_twist_cmds',
  SERVO_JOINT: '/robot_manipulator_velocity_controller/commands',
  CHANGE_MODE: '/change_mode',
  EMERGENCY: '/nextup_emergency_trigger_controller/commands',
  JOINT_STATES: '/joint_states',
  DRIVER_STATUS: '/nextup_driver_status',
  DIGITAL_INPUTS: '/nextup_digital_inputs',
  NEXTUP_JOINT_STATES: '/nextup_joint_states',
  JOINT_VALUES: '/joint_values',
  CARTESIAN_VALUES: '/cartesian_values'

};

const JOINT_ORDER = ['joint1', 'joint2', 'joint3', 'joint4', 'joint5', 'joint6'];
const THROTTLE_MS = 100;
const SERVO_FRAME_FILE = "/home/nextup/NextupRobot/src/nextupWeb/user_config/frame.json";
const PLANNER_STATE_FILE = "/home/nextup/NextupRobot/src/nextupWeb/user_config/planner.json";


export class LightweightROSBridge {
  constructor(wsServer) {
    this.ws = wsServer;
    this.node = null;
    this.initialized = false;

    this.startServoClient = null;
    this.changePlanningPipelineClient = null;

    // In constructor:
    this.latestJointValues = [0, 0, 0, 0, 0, 0];
    this.latestCartesianValues = [0, 0, 0, 0, 0, 0];

    // Message classes (will be set in init)
    this.Twist = null;
    this.TwistStamped = null;
    this.Float64MultiArray = null;
    this.StringMsg = null;
    this.Bool = null;
    this.NextupDigitalOutputs = null;
    this.NextupEmergencyTrigger = null;
    this.Int8 = null;
    this.Float64 = null;

    // Reusable objects
    this.twistMsg = null;
    this.twistStampedMsg = null;
    this.jointMsg = null;
    this.stringMsg = null;
    this.boolMsg = null;

    // State caches
    this.currentMode = '8';
    this.currentFrame = 'end';
    this.lastRosbridgeStatus = 'STOPPED'; // cached until a real status arrives
    this.doStateCache = new Map();
    this.lastDIBroadcast = 0;
    this.lastMode = null;

    // ── Live mode-of-operation sync (2Hz, edge-triggered) ──
    this.lastDriveMode = null;        // last coarse 8/9 we acted on
    this.lastModeCheckTs = 0;         // throttle timestamp (2Hz => 500ms)
    this.MODE_CHECK_INTERVAL_MS = 500;
    this.resolvingMode = false;       // guard so GetSdo isn't called re-entrantly
    this.modeWaiters = new Set();     // pending waitForDriveMode resolvers

    // Pre-allocate arrays
    this.jointStatus = new Array(6);
    this.faultStatus = new Array(6);

    // Publishers cache
    this.publishers = new Map();

    // Load persisted frame
    // Load persisted frame
    this.loadServoFrame();

    // Last known GPIO DI/DO state, for REQUEST_GPIO_STATE resync
    this.lastGpioGroups = {};
  }

  loadServoFrame() {
    try {
      const dir = path.dirname(SERVO_FRAME_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(SERVO_FRAME_FILE)) {
        const raw = fs.readFileSync(SERVO_FRAME_FILE, "utf-8");
        const obj = JSON.parse(raw);
        this.currentFrame = obj.frame || "end";
      }
    } catch (err) {
      console.error("Failed to load servo frame:", err);
    }
  }

  saveServoFrame(frame) {
    try {
      fs.writeFileSync(SERVO_FRAME_FILE, JSON.stringify({ frame }, null, 2));
      this.publishFrameMode(frame);
    } catch (err) {
      console.error("Failed to save servo frame:", err);
    }
  }

  getPublisher(topic, messageType, qos = null) {
    let pub = this.publishers.get(topic);
    if (!pub) {
      pub = qos
        ? this.node.createPublisher(messageType, topic, qos)
        : this.node.createPublisher(messageType, topic);
      this.publishers.set(topic, pub);
    }
    return pub;
  }

  async init() {
    if (this.initialized) return;

    await rclnodejs.init();
    this.node = new rclnodejs.Node('web_backend_node');

    this.changePlanningPipelineClient = this.node.createClient(
      'std_srvs/srv/SetBool',
      '/change_planning_pipeline'
    );

    // In init(), after node creation:
    this.startServoClient = this.node.createClient(
      'std_srvs/srv/Trigger',
      '/servo_node/start_servo'
    );

    // EtherCAT SDO download (write) client — used for overspeed threshold on mode change
    this.setSdoClient = this.node.createClient(
      'ethercat_msgs/srv/SetSdo',
      '/ethercat_manager/set_sdo'
    );

    // EtherCAT SDO upload (read) client — used to read back actual thresholds
    // so the UI can determine the true current mode (Auto vs SafeAuto) on load.
    this.getSdoClient = this.node.createClient(
      'ethercat_msgs/srv/GetSdo',
      '/ethercat_manager/get_sdo'
    );
    // Load message types individually
    this.Twist = rclnodejs.require('geometry_msgs/msg/Twist');
    this.TwistStamped = rclnodejs.require('geometry_msgs/msg/TwistStamped');
    this.Float64MultiArray = rclnodejs.require('std_msgs/msg/Float64MultiArray');
    this.StringMsg = rclnodejs.require('std_msgs/msg/String');
    this.Bool = rclnodejs.require('std_msgs/msg/Bool');
    this.Int8 = rclnodejs.require('std_msgs/msg/Int8');
    this.Float64 = rclnodejs.require('std_msgs/msg/Float64');
    this.NextupDigitalOutputs = rclnodejs.require('nextup_joint_interfaces/msg/NextupDigitalOutputs');
    this.NextupEmergencyTrigger = rclnodejs.require('nextup_joint_interfaces/msg/NextupEmergencyTrigger');

    // Initialize reusable message objects
    this.twistMsg = new this.Twist();
    this.twistStampedMsg = new this.TwistStamped();
    this.jointMsg = new this.Float64MultiArray();
    this.stringMsg = new this.StringMsg();
    this.boolMsg = new this.Bool();

    // Setup all subscribers
    this.setupSubscribers();

    rclnodejs.spin(this.node);
    this.initialized = true;

    // The robot boots in jog (mode 9), so apply the jog overspeed profile
    // 3s after startup — enough time for the EtherCAT manager's services to
    // come up. Fire-and-forget: startup must not block on this.
    setTimeout(() => {
      this.applyStartupOverspeed();
    }, STARTUP_OVERSPEED_DELAY_MS);
  }

  /**
   * One-shot overspeed write at startup. The robot starts in jog, so the
   * drives get the jog profile. Failures are logged, never thrown — this
   * runs detached from init() and must not take the process down.
   */
  async applyStartupOverspeed() {
    try {
      const ov = await applyOverspeedOnly({ ros: this, mode: 'jog' });
      this.publishLogMessage(
        ov.ok
          ? 'INFO | startup | jog overspeed applied on boot'
          : `WARN | startup | jog overspeed incomplete: ${ov.message}`
      );
      // Robot boots in jog — reflect it in the UI.
      this.broadcastModeState('jog');
    } catch (err) {
      this.publishLogMessage(`ERROR | startup | jog overspeed failed: ${err.message}`);
    }
  }

  setupSubscribers() {
    // Cycle count
    let lastCycleTime = null;

    // In setupSubscribers():
    this.node.createSubscription('std_msgs/msg/Float64MultiArray', ROS_TOPICS.JOINT_VALUES, (msg) => {
      if (msg.data?.length >= 6) {
        this.latestJointValues = msg.data;
        this.ws.broadcast({ type: 'JOINT_VALUES', payload: { values: msg.data } });
      }
    });

    this.node.createSubscription('std_msgs/msg/Float64MultiArray', ROS_TOPICS.CARTESIAN_VALUES, (msg) => {
      if (msg.data?.length >= 6) {
        this.latestCartesianValues = msg.data;
        this.ws.broadcast({ type: 'CARTESIAN_VALUES', payload: { values: msg.data } });
      }
    });

    this.node.createSubscription('std_msgs/msg/Int32', '/cycle_count', (msg) => {
      const now = Date.now();
      let delta = null;
      if (lastCycleTime !== null) {
        delta = (now - lastCycleTime) / 1000;
      }
      lastCycleTime = now;
      this.ws.broadcast({ type: 'CYCLE_TIME', payload: delta });
    });

    // Driver status
    this.node.createSubscription(
      'nextup_joint_interfaces/msg/NextupDriverStatus',
      ROS_TOPICS.DRIVER_STATUS,
      (msg) => {
        for (let i = 0; i < JOINT_ORDER.length; i++) {
          const idx = msg.name.indexOf(JOINT_ORDER[i]);
          this.jointStatus[i] = idx !== -1 ? Boolean(msg.op_status[idx]) : false;
          this.faultStatus[i] = idx !== -1 ? Boolean(msg.fault[idx]) : false;
        }

        this.ws.broadcast({
          type: 'DRIVER_STATUS',
          payload: { jointStatus: [...this.jointStatus], faultStatus: [...this.faultStatus] }
        });
      }
    );

    // Digital inputs (throttled)
    this.node.createSubscription(
      'nextup_joint_interfaces/msg/NextupDigitalInputs',
      ROS_TOPICS.DIGITAL_INPUTS,
      (msg) => {
        const now = Date.now();
        if (now - this.lastDIBroadcast >= THROTTLE_MS) {
          this.lastDIBroadcast = now;

          const jointCount = msg.name?.length || 0;
          const diMap = [msg.di1, msg.di2, msg.di3, msg.di4, msg.di5, msg.sto1, msg.sto2, msg.edm];
          const payload = [];

          for (let drv = 0; drv < jointCount; drv++) {
            const driverData = [];
            for (let di = 0; di < diMap.length; di++) {
              driverData.push(diMap[di]?.[drv] ?? false);
            }
            payload.push(driverData);
          }

          this.ws.broadcast({ type: 'DI_STATUS', payload });

          if (msg.di5) {
            const emergency = msg.di5.map(Boolean);
            this.ws.broadcast({ type: 'EMERGENCY_STATUS', payload: { jointStatus: emergency } });
          }
        }
      }
    );

    // Mode of operation
    this.node.createSubscription(
      'nextup_joint_interfaces/msg/NextupJointState',
      '/nextup_joint_states',
      (msg) => {

        // Build index map once per message — handles random joint order
        const indexMap = {};
        msg.name.forEach((name, i) => indexMap[name] = i);

        // Positions — guaranteed j1,j2,j3,j4,j5,j6 order, radians
        const positions = JOINT_ORDER.map(name => msg.position[indexMap[name]] ?? 0);

        // Mode of operation
        const modeOfOperation = msg.modeofoperation?.[0] ?? null;

        // Homing check — done once here instead of on every iframe
        const homingStatus = positions.map(pos => Math.abs(pos).toFixed(3) === "0.000");

        this.latestPositions = positions;

        this.ws.broadcast({
          type: 'JOINT_STATES',
          payload: {
            positions,        // float64[6], radians, always j1→j6
            homingStatus,     // bool[6], precomputed
          }
        });

        if (modeOfOperation !== null) {
          // Resolve any pending waitForDriveMode() on the RAW stream (not the
          // throttled path) so mode-confirmation is as prompt as possible.
          if (this.modeWaiters.size > 0) {
            for (const waiter of this.modeWaiters) {
              if (waiter.target === modeOfOperation) waiter.resolve(true);
            }
          }
          this.handleModeOfOperation(modeOfOperation);
        }
      }
    );

    for (let driver = 1; driver <= 6; driver++) {
      const topic = `/nextup_digital_output_controller_${driver}/commands`;
      this.node.createSubscription(
        'nextup_joint_interfaces/msg/NextupDigitalOutputs',
        topic,
        (msg) => {
          const payload = { driver };

          if (msg.do1?.length) payload.do1 = msg.do1[0];
          if (msg.do2?.length) payload.do2 = msg.do2[0];
          if (msg.do3?.length) payload.do3 = msg.do3[0];
          if (msg.pi_p?.length) payload.do4 = msg.pi_p[0];

          // Only broadcast if at least one field was actually set
          if (Object.keys(payload).length > 1) {
            this.ws.broadcast({ type: 'DO_STATUS', payload });
          }
        }
      );
    }

    // Active nodes
    this.node.createSubscription('std_msgs/msg/String', '/active_nodes_report', (msg) => {
      const list = msg.data.split(',').map(s => s.trim()).filter(Boolean);
      this.ws.broadcast({ type: 'ACTIVE_NODES', payload: list });
    });

    // Logs
    this.node.createSubscription('std_msgs/msg/String', '/logs_topic', (msg) => {
      this.ws.broadcast({ type: 'LOG_MESSAGE_INCOMING', payload: msg.data });
      // Persist to live_logs.json (queued, ring-buffered) for the history viewer.
      saveLiveLog(msg.data);
    });

    // Motion status
    this.node.createSubscription('std_msgs/msg/String', '/control_process_motion_bt_status', (msg) => {
      this.ws.broadcast({ type: 'MOTION_STATUS', payload: msg.data.toLowerCase() });
    });

    // Motion active
    this.node.createSubscription('std_msgs/msg/Bool', '/motion_start_bt_active', (msg) => {
      this.ws.broadcast({ type: 'MOTION_ACTIVE', payload: msg.data });
    });

    // Process status
    this.node.createSubscription('std_msgs/msg/String', '/control_process_control_bt_status', (msg) => {
      this.ws.broadcast({ type: 'PROCESS_STATUS', payload: msg.data });
    });

    // Control active
    this.node.createSubscription('std_msgs/msg/Bool', '/control_start_bt_active', (msg) => {
      this.ws.broadcast({ type: 'CONTROL_ACTIVE', payload: msg.data });
    });

    // Log Fetcher 
    this.node.createSubscription(
      "std_msgs/msg/String",
      "/bt_toast_popup",
      (msg) => {

        saveLogMessage(msg.data);

        const [message, messageType, duration] = msg.data.split(",");
        if (messageType && messageType.trim().toLowerCase() === "failure") {
          this.ws.broadcast({
            type: "BT_TOAST_POPUP",
            payload: {
              message: message?.trim(),
              messageType: messageType?.trim().toLowerCase(),
              duration: Number(duration) || 0
            }
          });
        }
      }
    );

    //GPIO TOPICS SUBS AND PUBS
    this.node.createSubscription(
      "control_msgs/msg/DynamicInterfaceGroupValues",
      "/nextup_gpio_command_controller/gpio_states",
      (msg) => {
        const groups = {};
        const grpNames = msg.interface_groups || [];
        const values = msg.interface_values || [];

        grpNames.forEach((g, gi) => {
          const iv = values[gi];
          if (!iv) return;
          const names = iv.interface_names || [];
          const vals = iv.values || [];
          // Merge onto cached state — this topic only ever carries DI on
          // this hardware (confirmed via `ros2 topic echo`), so a naive
          // replace would wipe any DO state we're tracking elsewhere.
          const gState = this.lastGpioGroups[g] || (this.lastGpioGroups[g] = { di: {}, do: {} });

          names.forEach((name, i) => {
            const v = !!vals[i];
            const diMatch = /^di0*(\d+)$/i.exec(name);
            const doMatch = /^do0*(\d+)$/i.exec(name);
            if (diMatch) gState.di[Number(diMatch[1])] = v;
            if (doMatch) gState.do[Number(doMatch[1])] = v;
          });

          groups[g] = gState;
        });

        this.ws.broadcast({ type: 'GPIO_STATE', payload: { groups } });
      }
    );

    this.node.createSubscription(
      "control_msgs/msg/DynamicInterfaceGroupValues",
      "/nextup_gpio_command_controller/commands",
      (msg) => {
        const group = msg.interface_groups?.[0];
        const iv = msg.interface_values?.[0];
        if (!group || !iv) return;

        const names = iv.interface_names || [];
        const vals = iv.values || [];
        const doPatch = {};

        names.forEach((name, i) => {
          const m = /^do0*(\d+)$/i.exec(name);
          if (m) doPatch[Number(m[1])] = !!vals[i];
        });
        if (Object.keys(doPatch).length === 0) return;

        // Fold into the same cache GPIO_STATE reads from, so a later
        // REQUEST_GPIO_STATE resync reflects the last known DO write too.
        const gState = this.lastGpioGroups[group] || (this.lastGpioGroups[group] = { di: {}, do: {} });
        Object.assign(gState.do, doPatch);

        this.ws.broadcast({
          type: 'GPIO_PUBLISH_CONFIRM',
          payload: { group, do: doPatch },
        });
      }
    );

    // Rosbridge process status
    this.node.createSubscription('std_msgs/msg/String', '/control_process_rosbridge_status', (msg) => {
      this.lastRosbridgeStatus = msg.data;
      this.ws.broadcast({ type: 'ROSBRIDGE_STATUS', payload: msg.data });
    });
  }






  // ========== PUBLISH METHODS ==========

  publishMove(data) {
    const pub = this.getPublisher('/cmd_vel', 'geometry_msgs/msg/Twist');
    this.twistMsg.linear.x = data?.linear || 0;
    this.twistMsg.angular.z = data?.angular || 0;
    pub.publish(this.twistMsg);
  }

  publishServoTwist(linear, angular) {
    const pub = this.getPublisher('/servo_node/delta_twist_cmds', 'geometry_msgs/msg/TwistStamped');

    const now = Date.now();
    this.twistStampedMsg.header.frame_id = this.currentFrame;
    this.twistStampedMsg.header.stamp.sec = Math.floor(now / 1000);
    this.twistStampedMsg.header.stamp.nanosec = (now % 1000) * 1_000_000;
    this.twistStampedMsg.twist.linear.x = linear?.x ?? 0;
    this.twistStampedMsg.twist.linear.y = linear?.y ?? 0;
    this.twistStampedMsg.twist.linear.z = linear?.z ?? 0;
    this.twistStampedMsg.twist.angular.x = angular?.x ?? 0;
    this.twistStampedMsg.twist.angular.y = angular?.y ?? 0;
    this.twistStampedMsg.twist.angular.z = angular?.z ?? 0;

    pub.publish(this.twistStampedMsg);
  }

  publishServoJoint(data) {
    const pub = this.getPublisher('/robot_manipulator_velocity_controller/commands', 'std_msgs/msg/Float64MultiArray');
    this.jointMsg.data = data;
    pub.publish(this.jointMsg);
  }
  
  publishDO(driver, doId, state) {
    const topic = `/nextup_digital_output_controller_${driver}/commands`;
    const pub = this.getPublisher(topic, 'nextup_joint_interfaces/msg/NextupDigitalOutputs');

    const fieldMap = { 1: 'do1', 2: 'do2', 3: 'do3', 4: 'pi_p' };
    const field = fieldMap[doId];

    if (!field) {
      console.warn(`publishDO: unknown doId ${doId}`);
      return;
    }

    const msg = new this.NextupDigitalOutputs();
    msg.do1 = [];
    msg.do2 = [];
    msg.do3 = [];
    msg.pi_p = [];

    msg[field] = [state];

    pub.publish(msg);
  }

  /**
   * Publishes a single DO channel command to the dynamic-group GPIO
   * controller. `group` is the free-form group name (e.g. "gpio1"),
   * `channel` is 1-8. Mirrors the DynamicInterfaceGroupValues shape the
   * controller expects — publish() accepts a plain object here since the
   * message has nested array-of-submessage fields.
   */
  publishGPIOCommand(group, channel, value) {
    if (!this.node) return;
    const pub = this.getPublisher(
      '/nextup_gpio_command_controller/commands',
      'control_msgs/msg/DynamicInterfaceGroupValues'
    );
    pub.publish({
      header: { stamp: { sec: 0, nanosec: 0 }, frame_id: '' },
      interface_groups: [group],
      interface_values: [
        { interface_names: ['do' + channel], values: [value ? 1 : 0] }
      ]
    });
  }

  /**
   * Live mode-of-operation sync from /nextup_joint_states.
   * - Throttled to 2Hz (MODE_CHECK_INTERVAL_MS) to minimize system load.
   * - Edge-triggered: only acts when the coarse drive mode (8/9) changes.
   * - On a 9→8 edge, calls GetSdo ONCE to disambiguate auto vs safeauto.
   *   Other transitions (→9) resolve to 'jog' without a service call.
   * Broadcasts a resolved MODE_STATE so the UI can follow external changes.
   */
  handleModeOfOperation(modeOfOperation) {
    const now = Date.now();

    // Fast path: unchanged mode → apply 2Hz throttle to avoid any work at
    // full joint_states rate. (We still let a *changed* mode through
    // immediately so external changes reflect with minimal latency.)
    const changed = modeOfOperation !== this.lastDriveMode;
    if (!changed && now - this.lastModeCheckTs < this.MODE_CHECK_INTERVAL_MS) {
      return;
    }
    this.lastModeCheckTs = now;

    if (!changed) {
      // Same mode, throttle window elapsed — nothing to do. We intentionally
      // do NOT re-broadcast steady state (keeps the bus quiet).
      return;
    }

    const prev = this.lastDriveMode;
    this.lastDriveMode = modeOfOperation;
    this.currentMode = String(modeOfOperation);

    // Mode 9 → jog, no service needed.
    if (modeOfOperation === 9) {
      this.publishLogMessage(`INFO | mode_sync | drive mode ${prev}→9 (jog)`);
      this.ws.broadcast({
        type: 'MODE_STATE',
        payload: { driveMode: 9, mode: 'jog', threshold: null, source: 'edge' },
      });
      return;
    }

    // Mode 8 → auto OR safeauto. Resolve via GetSdo, but only once per edge.
    if (modeOfOperation === 8) {
      // Broadcast the coarse edge immediately so the UI can react (it will
      // refine to auto/safeauto when the resolve completes).
      this.ws.broadcast({
        type: 'MODE_STATE',
        payload: { driveMode: 8, mode: null, threshold: null, source: 'edge-pending' },
      });

      if (this.resolvingMode) return;
      this.resolvingMode = true;

      detectCurrentMode({ ros: this, driveMode: 8 })
        .then((res) => {
          this.publishLogMessage(`INFO | mode_sync | drive mode ${prev}→8 resolved to ${res.mode} (threshold=${res.threshold})`);
          this.ws.broadcast({
            type: 'MODE_STATE',
            payload: { driveMode: 8, mode: res.mode, threshold: res.threshold, source: res.source },
          });
        })
        .catch((err) => {
          this.publishLogMessage(`ERROR | mode_sync | resolve after ${prev}→8 failed: ${err.message}`);
          // fall back to safeauto (the conservative choice)
          this.ws.broadcast({
            type: 'MODE_STATE',
            payload: { driveMode: 8, mode: 'safeauto', threshold: null, source: 'resolve-error' },
          });
        })
        .finally(() => { this.resolvingMode = false; });
      return;
    }

    // Any other value — just report coarse.
    this.ws.broadcast({
      type: 'MODE_STATE',
      payload: { driveMode: modeOfOperation, mode: null, threshold: null, source: 'edge' },
    });
  }

  /**
   * Wait until /nextup_joint_states reports the target coarse drive mode
   * (8 or 9), or resolve false after timeoutMs. If we already see the target
   * mode cached, resolves immediately. Used to confirm a change_mode took
   * effect before proceeding (e.g. before publishing home).
   * @param {number} target 8 | 9
   * @param {number} timeoutMs
   * @returns {Promise<boolean>} true if confirmed by feedback, false on timeout
   */
  waitForDriveMode(target, timeoutMs = 3000) {
    // Fast path: already there.
    if (this.lastDriveMode === target) return Promise.resolve(true);

    return new Promise((resolve) => {
      const waiter = { target, resolve: null };
      let settled = false;

      const done = (confirmed) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.modeWaiters.delete(waiter);
        resolve(confirmed);
      };

      waiter.resolve = () => done(true);
      this.modeWaiters.add(waiter);

      const timer = setTimeout(() => done(false), timeoutMs);
    });
  }

  publishChangeMode(mode) {
    const pub = this.getPublisher('/change_mode', 'std_msgs/msg/String');
    this.stringMsg.data = mode;
    pub.publish(this.stringMsg);
  }

  publishGpioCommand(group, channel, value) {
    const pub = this.getPublisher('/nextup_gpio_command_controller/commands', 'control_msgs/msg/DynamicInterfaceGroupValues');
    pub.publish({
      header: {},
      interface_groups: [group],
      interface_values: [{
        interface_names: [`do${channel}`],
        values: [value]
      }]
    });
  }

  /**
   * Broadcast a resolved UI mode directly (bypassing edge detection).
   * Used after an action deliberately sets a mode where the coarse drive
   * mode (8/9) did NOT change — e.g. Auto→SafeAuto (home) or SafeAuto→Auto
   * (start_bt), which are threshold-only transitions the edge detector
   * can't see. Keeps lastDriveMode in sync so no spurious edge fires later.
   * @param {'auto'|'safeauto'|'jog'} uiMode
   */
  broadcastModeState(uiMode) {
    const driveMode = uiMode === 'jog' ? 9 : 8;
    this.lastDriveMode = driveMode;      // keep edge-detector cache consistent
    this.currentMode = String(driveMode);
    this.lastModeCheckTs = Date.now();
    this.ws.broadcast({
      type: 'MODE_STATE',
      payload: { driveMode, mode: uiMode, threshold: null, source: 'action' },
    });
    this.publishLogMessage(`INFO | mode_sync | action-applied mode=${uiMode} (driveMode ${driveMode})`);
  }

  /**
   * EtherCAT SDO download (write) to a single drive.
   * SetSdo.srv request: int16 master_id, int16 slave_position, int16 sdo_index,
   *                     int16 sdo_subindex, string sdo_data_type, string sdo_value
   *          response : bool success, string sdo_return_message
   * @returns {Promise<{success:boolean, message:string}>}
   */

  async setSdo({ masterId = 0, slavePosition, sdoIndex, sdoSubindex, sdoDataType, sdoValue, timeoutMs = 300 }) {
    if (!this.setSdoClient) {
      return { success: false, message: 'SetSdo client not initialized' };
    }
    if (!this.setSdoClient.isServiceServerAvailable()) {
      return { success: false, message: 'ethercat_manager/set_sdo not available' };
    }

    const SetSdo = rclnodejs.require('ethercat_msgs/srv/SetSdo');
    const request = new SetSdo.Request();
    request.master_id = masterId;
    request.slave_position = slavePosition;
    request.sdo_index = sdoIndex;         // e.g. 0x200A
    request.sdo_subindex = sdoSubindex;   // e.g. 0x09
    request.sdo_data_type = sdoDataType;  // 'uint16'
    request.sdo_value = String(sdoValue);

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve({ success: false, message: `SetSdo timed out (slave ${slavePosition}, ${timeoutMs}ms)` });
      }, timeoutMs);

      this.setSdoClient.sendRequest(request, (response) => {
        clearTimeout(timer);
        resolve({
          success: response?.success || false,
          message: response?.sdo_return_message || 'no message',
        });
      });
    });
  }

  /**
   * EtherCAT SDO upload (read) from a single drive.
   * GetSdo.srv request: int16 master_id, uint16 slave_position, uint16 sdo_index,
   *                     uint8 sdo_subindex, string sdo_data_type
   *          response : bool success, string sdo_return_message,
   *                     string sdo_return_value_string, float64 sdo_return_value
   * @returns {Promise<{success:boolean, message:string, valueString:string, value:number}>}
   */
  async getSdo({ masterId = 0, slavePosition, sdoIndex, sdoSubindex, sdoDataType, timeoutMs = 300 }) {
    if (!this.getSdoClient) {
      return { success: false, message: 'GetSdo client not initialized' };
    }
    if (!this.getSdoClient.isServiceServerAvailable()) {
      return { success: false, message: 'ethercat_manager/get_sdo not available' };
    }

    const GetSdo = rclnodejs.require('ethercat_msgs/srv/GetSdo');
    const request = new GetSdo.Request();
    request.master_id = masterId;
    request.slave_position = slavePosition;
    request.sdo_index = sdoIndex;
    request.sdo_subindex = sdoSubindex;
    request.sdo_data_type = sdoDataType;

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve({ success: false, message: `GetSdo timed out (slave ${slavePosition}, ${timeoutMs}ms)` });
      }, timeoutMs);

      this.getSdoClient.sendRequest(request, (response) => {
        clearTimeout(timer);
        resolve({
          success: response?.success || false,
          message: response?.sdo_return_message || 'no message',
          valueString: response?.sdo_return_value_string || '',
          value: typeof response?.sdo_return_value === 'number' ? response.sdo_return_value : NaN,
        });
      });
    });
  }

  publishFrameMode(frameName) {
    const pub = this.getPublisher('/frame_mode', 'std_msgs/msg/String');
    this.stringMsg.data = frameName;
    pub.publish(this.stringMsg);
  }

  publishMotionCommand(command) {
    const pub = this.getPublisher('/control_process_motion_bt', 'std_msgs/msg/String');
    this.stringMsg.data = command;
    pub.publish(this.stringMsg);
  }

  publishMoveitStopCommand() {
    const pub = this.getPublisher('/trajectory_execution_event', 'std_msgs/msg/String');
    this.stringMsg.data = "stop";
    pub.publish(this.stringMsg);
  }

  publishMotionStart(isActive) {
    const pub = this.getPublisher('/motion_start_bt', 'std_msgs/msg/Bool');
    this.boolMsg.data = isActive;
    pub.publish(this.boolMsg);
  }

  publishUiCommand(command) {
    const pub = this.getPublisher('/ui_commands', 'std_msgs/msg/String');
    this.stringMsg.data = command;
    pub.publish(this.stringMsg);
  }

  publishStringTopic(topic, value) {
    const pub = this.getPublisher(topic, 'std_msgs/msg/String');
    this.stringMsg.data = value;
    pub.publish(this.stringMsg);
  }

  publishBoolTopic(topic, value) {
    const pub = this.getPublisher(topic, 'std_msgs/msg/Bool');
    this.boolMsg.data = value;
    pub.publish(this.boolMsg);
  }

  publishProcessControl(command) {
    const pub = this.getPublisher('/control_process_control_bt', 'std_msgs/msg/String');
    this.stringMsg.data = command;
    pub.publish(this.stringMsg);
  }

  publishRosbridgeControl(command) {
    const pub = this.getPublisher('/control_process_rosbridge', 'std_msgs/msg/String');
    this.stringMsg.data = command;
    pub.publish(this.stringMsg);
  }

  publishSpeedScale(value) {
    const pub = this.getPublisher('/dynamic_speed_scale', 'std_msgs/msg/Float64');
    const msg = new this.Float64();
    msg.data = value;
    pub.publish(msg);
  }

  publishSpeedScaleInt8(value) {
    const pub = this.getPublisher('/speed_scale', 'std_msgs/msg/Int8');
    const msg = new this.Int8();
    msg.data = Math.round(value);
    pub.publish(msg);
  }

  publishCNCSelection(selection) {
    const pub = this.getPublisher('/select_cnc', 'std_msgs/msg/String');
    this.stringMsg.data = selection;
    pub.publish(this.stringMsg);
  }

  publishMotionType(type) {
    if (type === "joint") {
      const pub = this.getPublisher('/joint_motion', 'std_msgs/msg/Bool');
      this.boolMsg.data = true;
      pub.publish(this.boolMsg);
    } else {
      const pub = this.getPublisher('/cartesian_motion', 'std_msgs/msg/Bool');
      this.boolMsg.data = true;
      pub.publish(this.boolMsg);
    }
  }

  triggerEmergency() {
    const pub = this.getPublisher('/nextup_emergency_trigger_controller/commands', 'nextup_joint_interfaces/msg/NextupEmergencyTrigger');
    const msg = new this.NextupEmergencyTrigger();
    msg.emergencytrigger = true;
    pub.publish(msg);
  }

  /**
   * Trigger emergency to clear fault state, then publish /reset_fault 1.5s later.
   * Returns a promise that resolves once /reset_fault has actually been
   * published, so callers can time follow-up work (e.g. the overspeed writes
   * after the reset state machine settles) from the correct moment.
   * @returns {Promise<void>}
   */
  resetFault() {
    // const pub = this.getPublisher('/reset_fault', 'std_msgs/msg/Bool');
    this.boolMsg.data = true;
    // pub.publish(this.boolMsg);

    // Also trigger emergency to clear fault state
    this.triggerEmergency();

    return new Promise((resolve) => {
      setTimeout(() => {
        const pub2 = this.getPublisher('/reset_fault', 'std_msgs/msg/Bool');
        pub2.publish(this.boolMsg);
        resolve();
      }, 1500);
    });
  }

  loadPlannerState() {
    try {
      const dir = path.dirname(PLANNER_STATE_FILE);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(PLANNER_STATE_FILE)) {
        const raw = fs.readFileSync(PLANNER_STATE_FILE, "utf-8");
        const obj = JSON.parse(raw);
        this.currentPlanner = obj.planner === 'OMPL' ? 'OMPL' : 'PILZ';
      }
    } catch (err) {
      console.error("Failed to load planner state:", err);
    }
  }

  savePlannerState(planner) {
    try {
      fs.writeFileSync(PLANNER_STATE_FILE, JSON.stringify({ planner }, null, 2));
    } catch (err) {
      console.error("Failed to save planner state:", err);
    }
  }

  getCurrentPlanner() {
    return this.currentPlanner;
  }

  async startServo() {
    if (!this.startServoClient) {
      return { success: false, message: "Service client not initialized" };
    }

    // Check if service is available
    const isAvailable = this.startServoClient.isServiceServerAvailable();
    if (!isAvailable) {
      return { success: false, message: "Servo service not available" };
    }

    const Trigger = rclnodejs.require('std_srvs/srv/Trigger');
    const request = new Trigger.Request();

    return new Promise((resolve) => {
      // Timeout after 5 seconds
      const timer = setTimeout(() => {
        resolve({ success: false, message: "Service call timed out" });
      }, 5000);

      this.startServoClient.sendRequest(request, (response) => {
        clearTimeout(timer);
        resolve({
          success: response?.success || false,
          message: response?.message || "Servo started"
        });
      });
    });
  }


  async setPlanningPipeline(useOmpl) {
    if (!this.changePlanningPipelineClient) {
      return { success: false, message: "Pipeline client not initialized" };
    }

    if (!this.changePlanningPipelineClient.isServiceServerAvailable()) {
      return { success: false, message: "/change_planning_pipeline service not available" };
    }

    const SetBool = rclnodejs.require('std_srvs/srv/SetBool');
    const request = new SetBool.Request();
    request.data = useOmpl; // true = OMPL, false = PILZ

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        resolve({ success: false, message: "change_planning_pipeline call timed out" });
      }, 5000);

      this.changePlanningPipelineClient.sendRequest(request, (response) => {
        clearTimeout(timer);

        const ok = response?.success || false;
        if (ok) {
          // Only persist once the node confirms it actually switched
          this.currentPlanner = useOmpl ? 'OMPL' : 'PILZ';
          this.savePlannerState(this.currentPlanner);
        }

        resolve({
          success: ok,
          message: response?.message || "no message",
        });
      });
    });
  }
  async callMonitoringStart() {
    const client = this.node.createClient('std_srvs/srv/Trigger', '/monitoring_start');
    const Trigger = rclnodejs.require('std_srvs/srv/Trigger');
    const request = new Trigger.Request();

    return new Promise((resolve) => {
      client.sendRequest(request, resolve);
    });
  }

  async callMonitoringStop() {
    const client = this.node.createClient('std_srvs/srv/Trigger', '/monitoring_stop');
    const Trigger = rclnodejs.require('std_srvs/srv/Trigger');
    const request = new Trigger.Request();

    return new Promise((resolve) => {
      client.sendRequest(request, resolve);
    });
  }

  publishAutoGenerateXML(shouldGenerate) {
    const pub = this.getPublisher('/auto_generate_xml', 'std_msgs/msg/Bool');
    this.boolMsg.data = shouldGenerate;
    pub.publish(this.boolMsg);
  }

  publishAutoGenerateSequence(sequenceData) {
    const pub = this.getPublisher('/auto_plan_sequence', 'std_msgs/msg/String');
    this.stringMsg.data = sequenceData;
    pub.publish(this.stringMsg);
  }

  publishLogMessage(logData) {
    const pub = this.getPublisher('/logs_topic', 'std_msgs/msg/String');
    this.stringMsg.data = logData;
    pub.publish(this.stringMsg);
  }

  setCurrentFrame(frame) {
    this.currentFrame = frame;
    this.saveServoFrame(frame);
  }

  getCurrentFrame() {
    return this.currentFrame;
  }

  getRosbridgeStatus() {
    return this.lastRosbridgeStatus;
  }
  getLastGpioState() {
    return { groups: this.lastGpioGroups };
  }

  getCurrentMode() {
    return this.currentMode;
  }

  async shutdown() {
    if (this.node) {
      await this.node.destroy();
    }
  }
}