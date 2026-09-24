//mainTreeRoutes.js

import express from 'express';
const router = express.Router();


import { addCustomNodeController, addDoDiSubtreeAsChildController, addNodeAfterController, addNodeController, addRunPathSubtreeAsChildController, addSubtreeAsChildController, addSubtreeController, addWrapperController, copyNodeController, deleteNodeController, deleteSubtreeController, deleteWrapperOnlyController, getDoDiSubtreeById, getDoDiSubtreesController, getNodeTypeController, getRunPathSubtreeByIdController, getRunPathSubtreesController, getSubtreeByIdController, getSubtreesController, getTreeXMLController, moveNodeAfterController, swapNodesController, updateNodeController } from "../controller/mainTreeController.js";

router.get('/getNodeTypes', getNodeTypeController);

router.post('/addCustomNode', addCustomNodeController);

// DO/DI SUBTREES
router.get('/getDoDiSubtrees', getDoDiSubtreesController);


router.get('/getDoDiSubtree/:id', getDoDiSubtreeById);

router.post('/addDoDiSubtreeAsChild', addDoDiSubtreeAsChildController);

// RUN PATH SUBTREES
router.get('/getRunPathSubtrees', getRunPathSubtreesController);

router.get('/getRunPathSubtree/:id', getRunPathSubtreeByIdController);

router.post('/addRunPathSubtreeAsChild', addRunPathSubtreeAsChildController);

/* -------------------------------------------------
  NORMAL SUBTREE ENDPOINTS
  ------------------------------------------------- */

router.get('/getSubtrees', getSubtreesController);

router.get('/getSubtree/:id', getSubtreeByIdController);

router.post('/addSubtree', addSubtreeController);

/* -------------------------------------------------
   Update node attributes (by _uid path)
   ------------------------------------------------- */
router.post('/updateNode', updateNodeController);


router.post('/addNode', addNodeController);

router.post('/addNodeAfter', addNodeAfterController);

// DELETE NODE
router.post('/deleteNode', deleteNodeController);

// DELETE SUBTREE
router.post('/deleteSubtree', deleteSubtreeController);
// ADD SUBTREE AS CHILD (FULL copy OR <SubTreePlus> reference)
router.post('/addSubtreeAsChild', addSubtreeAsChildController);


// DELETE WRAPPER ONLY
router.post('/deleteWrapperOnly', deleteWrapperOnlyController);

// ADD WRAPPER
router.post('/addWrapper', addWrapperController);

// SWAP NODES
router.post('/swapNodes', swapNodesController);

router.post('/moveNodeAfter', moveNodeAfterController);


router.post('/getTreeXML', getTreeXMLController);

router.post('/copyNode', copyNodeController);


export default router;