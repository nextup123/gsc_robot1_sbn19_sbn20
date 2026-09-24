import express from "express";
import {
  checkDuplicatePointsController,
  checkPathContinuityController,
  getPathController,
  testingPointsController,
} from "../controller/pathController.js";

const router = express.Router();


// Endpoint to check path continuity
router.get("/check_path_continuity", checkPathContinuityController);

// New endpoint to find duplicate points
router.get("/check_duplicate_points", checkDuplicatePointsController);

// Endpoint to get all paths (for visualization)
router.get("/paths", getPathController);

// Endpoint to get testing points
router.get("/testing_points", testingPointsController);

export default router;