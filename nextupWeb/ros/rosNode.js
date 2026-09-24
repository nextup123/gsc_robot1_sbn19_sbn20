//backend - rosNode.js

import rclnodejs from "rclnodejs";

async function initROS(io) {
  await rclnodejs.init();
  const node = new rclnodejs.Node("dashboard_node");

  // DRIVER STATUS
  node.createSubscription(
    "nextup_joint_interfaces/msg/NextupDriverStatus",
    "/nextup_driver_status",
    (msg) => {
      const jointOrder = [
        "joint1",
        "joint2",
        "joint3",
        "joint4",
        "joint5",
        "joint6",
      ];

      const jointStatus = jointOrder.map((j) => {
        const i = msg.name.indexOf(j);
        return i !== -1 ? Boolean(msg.op_status[i]) : false;
      });

      const faultStatus = jointOrder.map((j) => {
        const i = msg.name.indexOf(j);
        return i !== -1 ? Boolean(msg.fault[i]) : false;
      });

      io.broadcast({
        type: "DRIVER_STATUS",
        payload: { jointStatus, faultStatus },
      });
    },
  );

  // EMERGENCY
  node.createSubscription(
    "nextup_joint_interfaces/msg/NextupDigitalInputs",
    "/nextup_digital_inputs",
    (msg) => {
      const emergency = msg.di5.map(Boolean);

      io.broadcast({
        type: "EMERGENCY_STATUS",
        payload: { jointStatus: emergency },
      });
    },
  );

  // ACTIVE NODES
  node.createSubscription(
    "std_msgs/msg/String",
    "/active_nodes_report",
    (msg) => {
      const list = msg.data
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);

      io.broadcast({
        type: "ACTIVE_NODES",
        payload: list,
      });
    },
  );

  rclnodejs.spin(node);
}

export { initROS };
