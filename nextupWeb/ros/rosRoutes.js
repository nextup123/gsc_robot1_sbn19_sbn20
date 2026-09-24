//backend - rosRoutes.js

import express from "express";

import {
  diListController,
  doListController,
  getDiLayoutController,
  getDoLayoutController,
  getLogsController,
  getPlannerStateController,
  moveToPointController,
  postDiLayoutController,
  postDoLayoutController,
  getServoFrameController,  // 🆕 ADD THIS IMPORT
  setFrameController,
  setMotionTypeController,
  startMotionPlanningController,
  togglePlannerController,
  publishMoveitStopController,
  getEmergencyManagerYamlController, 
  saveEmergencyManagerYamlController
} from "./rosController.js";

const router = express.Router();

// ===== File Path =====

// ===== Endpoint: List all DOs =====
router.get("/do-list", doListController);

// Ensure directory exists

// GET DO layout
router.get("/do-layout", getDoLayoutController);

// POST DO layout
router.post("/do-layout", postDoLayoutController);

// ===== Endpoint: List all DIs =====
router.get("/di-list", diListController);

router.get("/di-layout", getDiLayoutController);

router.post("/di-layout", postDiLayoutController);

router.get("/startPlanning", startMotionPlanningController);

router.get("/stopMoveit", publishMoveitStopController);

router.get("/logs", getLogsController);

// ════════════════════════════════════════════════════════════════════
// 🆕 SERVO FRAME ENDPOINTS
// ════════════════════════════════════════════════════════════════════
router.get('/get_frame', getServoFrameController);  // 🆕 GET current frame
router.post('/set_frame', setFrameController);      // Already existed

//ROS ROUTES RELATED TO POINT PLANNING//


router.post("/moveToPoint", moveToPointController);

router.post("/setMotionType", setMotionTypeController);

router.post("/togglePlanner", togglePlannerController);

router.get("/plannerState", getPlannerStateController);

////EMERGENCY MANAGER YAML ////////////
router.get('/emergency-manager-yaml', getEmergencyManagerYamlController);
router.post('/emergency-manager-yaml', saveEmergencyManagerYamlController);


////////////////////////////////////////


//ROS ROUTES RELATED TO MAINWEB




export default router;