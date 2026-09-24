// routes/wsCalibrationRoutes.js
import express from "express";

import {
  getCalibrationController,
  addFrameController,
  deleteFrameController,
  setPointController,
  startCalibrationController,
  goToFrameOriginController,
  finishCalibrationController,
  goToPointController,
} from "../controller/wsCalibrationController.js";

const router = express.Router();

// Frame + point persistence
router.get("/getCalibration", getCalibrationController);
router.post("/addFrame", addFrameController);
router.post("/deleteFrame", deleteFrameController);
router.post("/setPoint", setPointController);

// Gating publishes
router.post("/startCalibration", startCalibrationController);
router.post("/goToFrameOrigin", goToFrameOriginController);
router.post("/finishCalibration", finishCalibrationController);

// Navigate to a single set point
router.post("/goToPoint", goToPointController);

export default router;