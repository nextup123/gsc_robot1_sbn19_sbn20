import express from 'express';

import  {
  getPointFileNameController,
  getPointsController,
  getPointBackupFileNamesController,
  addPointController,
  updatePointController,
  deletePointController,
  deleteAllController,
  reorderPointsController,
  canUndoController,
  undoController,
  getRobotStatusController,
  editedPointNotificationController,
  savePointFileController,
  loadBackupFileController,
  createNewFileController,
  deleteBackupFileController
}  from "../controller/pointPlanningBtController.js";

const router = express.Router();

// /getPointFileName endpoint
router.get("/getPointFileName", getPointFileNameController);

// /getPoints endpoint
router.get("/getPoints", getPointsController);

// /getPointsBackupFileNames endpoint
router.get("/getPointsBackupFileNames", getPointBackupFileNamesController);

// /addPoint endpoint
router.post("/addPoint", addPointController);

// /updatePoint endpoint
router.post("/updatePoint", updatePointController);

// /deletePoint endpoint
router.post("/deletePoint", deletePointController);

// /deleteAll endpoint
router.post("/deleteAll", deleteAllController);

// /reorderPoints endpoint
router.post("/reorderPoints", reorderPointsController);

// /undo endpoint
router.post("/undo", undoController);

// /canUndo endpoint
router.get("/canUndo", canUndoController);

// NEW ENDPOINTS FOR ROS COMMUNICATION
router.get("/robotStatus", getRobotStatusController);
router.post("/editedPoint", editedPointNotificationController);
router.post("/savePointFile", savePointFileController);
router.post("/loadBackupFile", loadBackupFileController);
router.post("/createNewFile", createNewFileController);
router.post("/deleteBackupFile", deleteBackupFileController);

export default router;