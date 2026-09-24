import express from "express";
import path from "path";
import { fileURLToPath } from "url";

import {
  checkFIleExistMiddleware,
  listLayoutsController,
  loadTreeController,
  saveLayoutController,
} from "../controller/pathTestingController.js";
import { TREE_LAYOUT_DIR } from "../config/path.js";


const router = express.Router();

router.use(checkFIleExistMiddleware );//running on every request for this router file

router.use("/tree_layout",express.static(TREE_LAYOUT_DIR));

router.get("/load-tree", loadTreeController);
router.post("/save-layout", saveLayoutController);
router.get("/list-layouts", listLayoutsController);

export default router;