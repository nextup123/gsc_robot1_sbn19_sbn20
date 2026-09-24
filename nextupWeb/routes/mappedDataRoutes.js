import express from 'express';
import { deleteMappedDataByKeyController, getMappedDataController, mappedDataByKeyController, mappedDataRawController, postMappedDataController } from '../controller/mappedDataController.js';

const router = express.Router();


// Ensure directory exists


// GET all mapped data
router.get('/mapped-data', getMappedDataController);

// POST update mapped data (full replacement or partial)
router.post('/mapped-data',postMappedDataController );

// POST add/update single entry
router.post('/mapped-data/:key', mappedDataByKeyController);

// DELETE single entry
router.delete('/mapped-data/:key', deleteMappedDataByKeyController);

// GET raw YAML content
router.get('/mapped-data/raw', mappedDataRawController);


export default router;