import express from "express";
import {
  addControlController,
  canUndoController,
  deleteAllController,
  deleteControlController,
  getControlByNameController,
  getTreeDataController,
  getXmlController,
  reorderSequenceContoller,
  undoController,
  updateControlController,
} from "../controller/ioController.js";
const router = express.Router();

router.post("/undo", undoController);

router.get("/canUndo", canUndoController);

router.post("/getXML", getXmlController);

router.get("/getTreeData", getTreeDataController);

router.get("/getControl/:name", getControlByNameController);

router.post("/addControl", addControlController);

router.post("/updateControl", updateControlController);

router.post("/deleteControl", deleteControlController);

router.post("/deleteAll", deleteAllController);

router.post("/reorderSequences", reorderSequenceContoller);

export default router;
