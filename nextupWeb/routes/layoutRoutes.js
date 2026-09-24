import express from 'express';
import { deleteByNameController, listLayoutController, loadByNameController, saveLayoutController } from '../controller/layoutController.js';

const router = express.Router();



// Get list of all layouts
router.get('/list', listLayoutController);

// Save a layout
router.post('/save', saveLayoutController);

// Load a layout
router.get('/load/:name',loadByNameController);

// Delete a layout
router.delete('/delete/:name', deleteByNameController);

export default router;