// routes/sequenceCreatorRoutes.js
import express from "express";
import {
  appendController,
  clearAllController,
  clearUndoController,
  deleteSequenceByIdController,
  getAllSequenceController,
  getLatestSequenceController,
  getUndoHistoryController,
  saveNewSequenceController,
  undoLastOperationController,
  updateSequenceByIdController,
} from "../controller/sequenceCreatorController.js";

const router = express.Router();




// Ensure config directory exists

// GET /sequences-creator - Get all sequences
router.get("/", getAllSequenceController);

// GET /undo - Get undo history
router.get("/undo", getUndoHistoryController);

// POST / - Save new sequence (handles both formats)
router.post("/", saveNewSequenceController);

// POST /append - Append to existing sequences (keeps old ones)
router.post("/append", appendController);

// GET /latest - Get the most recent sequence
router.get("/latest", getLatestSequenceController);

// PUT /:id - Update specific sequence
router.put("/:id", updateSequenceByIdController);

// DELETE /:id - Delete sequence
router.delete("/:id", deleteSequenceByIdController);

// POST /undo - Undo last operation
router.post("/undo", undoLastOperationController);

// POST /clear-undo - Clear undo history
router.post("/clear-undo", clearUndoController);

// POST /clear-all - Clear all sequences
router.post("/clear-all", clearAllController);

export default router;
