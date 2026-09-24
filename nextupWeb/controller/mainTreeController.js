//mainTreeController.js

import { RUNPATH_TEMPLATE_PATH, TEMPLATE_PATH, XML_BASE_DIR } from "../config/path.js";
import { ioFilePath } from "../config/path.js";
import { ensureUids, generateUniqueId, readAndParseXML, readNodeDefs, writeNodeDefs, writeXML } from "../service/mainTreeService.js";
import { jsonToXml, parseXmlString, stripInternalUids } from "../user_config/customXmlParser.js";
const XML_MAP = {
  mainTree: 'template.xml',
  runPathTree: 'run_path.xml',
  doDiTree: 'do_di.xml'
};

import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DO_DI_TEMPLATE_PATH = ioFilePath.DO_DI_TREE_XML_FILE;
import fs from 'fs/promises';
import path from 'path';


export const getNodeTypeController = async (req, res) => {
  try {
    const defs = await readNodeDefs();
    res.json(defs);
  } catch (err) {
    console.error('Failed to load node types:', err);
    res.status(500).send('Failed to load node types');
  }
};

export const addCustomNodeController = async (req, res) => {
  const { name, category, nodeType, isWrapper, attributes } = req.body;
  
  if (!name || !category || !nodeType) {
    return res.status(400).send('Name, category, and nodeType required');
  }
  
  // Validate nodeType
  const validNodeTypes = ['Action', 'Condition', 'Control', 'Decorator'];
  if (!validNodeTypes.includes(nodeType)) {
    return res.status(400).send('Invalid nodeType. Must be Action, Condition, Control, or Decorator');
  }
  
  try {
    const defs = await readNodeDefs();
    
    // Initialize categories if not exists
    if (!defs.categories) {
      defs.categories = {};
    }
    
    // Initialize category if not exists
    if (!defs.categories[category]) {
      defs.categories[category] = {
        display_name: category.charAt(0).toUpperCase() + category.slice(1),
        description: `Custom ${category} nodes`,
        nodes: {
          Action: {},
          Condition: {},
          Control: {},
          Decorator: {}
        }
      };
    }
    
    // Initialize node type if not exists
    if (!defs.categories[category].nodes[nodeType]) {
      defs.categories[category].nodes[nodeType] = {};
    }
    
    // Check if node already exists
    if (defs.categories[category].nodes[nodeType][name]) {
      return res.status(400).send('Custom node already exists in this category');
    }
    
    // Add the new node
    defs.categories[category].nodes[nodeType][name] = {
      type: isWrapper ? 'wrapper' : 'leaf',
      attributes: attributes || {},
      ...(isWrapper ? { children: [] } : {})
    };
    
    await writeNodeDefs(defs);
    res.json({ success: true, category, nodeType, name });
    
  } catch (err) {
    console.error('Error adding custom node:', err);
    res.status(500).send('Failed to add custom node: ' + err.message);
  }
};

export const getDoDiSubtreesController = async (req, res) => {
  try {
    const force = req.query.force_xml2js_parse === 'true';
    const result = await readAndParseXML(DO_DI_TEMPLATE_PATH, force);
    const allChildren = Array.isArray(result['@children']) ? result['@children'] : [];

    const subtrees = allChildren
      .filter(c => c.tagName === 'BehaviorTree')
      .map(c => ({ id: c.content['@attributes']?.ID }));

    if (subtrees.length === 0) {
      console.warn(`⚠ No DO/DI subtrees found in XML.`);
      return res.status(200).json({ message: 'No DO/DI subtrees found', subtrees: [] });
    }

    res.json(subtrees);
  } catch (err) {
    console.error('❌ Error in /getDoDiSubtrees:', err);
    res.status(500).json({ error: 'Failed to load DO/DI subtrees' });
  }
}

export const getDoDiSubtreeById = async (req, res) => {
  try {
    const result = await readAndParseXML(DO_DI_TEMPLATE_PATH);
    const subtree = result['@children']
      .find(c => c.tagName === 'BehaviorTree' && c.content['@attributes'].ID === req.params.id);
    if (!subtree) return res.status(404).send('DO/DI Subtree not found');
    res.json({ root: { '@children': [subtree] } });
  } catch (err) {
    res.status(500).send('Failed to load DO/DI subtree');
  }
}

export const addDoDiSubtreeAsChildController = async (req, res) => {
  const { subtreeId, parentPath, childSubtreeId, mode = 'full', attributes = {} } = req.body;

  try {
    const mainTree = await readAndParseXML();
    const doDiTree = await readAndParseXML(DO_DI_TEMPLATE_PATH);

    const subtree = mainTree['@children']
      .find(c => c.tagName === 'BehaviorTree' && c.content['@attributes'].ID === subtreeId);
    if (!subtree) return res.status(404).send('Target subtree not found');

    const childTree = doDiTree['@children']
      .find(c => c.tagName === 'BehaviorTree' && c.content['@attributes'].ID === childSubtreeId);
    if (!childTree) return res.status(404).send('DO/DI subtree not found');

    let parent = subtree.content;
    for (const id of parentPath) {
      const next = (parent['@children'] || [])
        .map(c => c.content)
        .find(c => c['@attributes']?._uid === id || c['@attributes']?.ID === id);
      if (!next) return res.status(400).send(`Invalid path: ${id}`);
      parent = next;
    }

    if (!parent['@children']) parent['@children'] = [];

    // Both modes are wrapped in a <Sequence> so multiple subtrees added at the
    // same level stay distinguishable.
    let addedNodes;
    if (mode === 'full') {
      const childCopy = JSON.parse(JSON.stringify(childTree));
      childCopy.content['@children'].forEach(child => {
        ensureUids(child.content);
      });
      addedNodes = childCopy.content['@children'];
    } else if (mode === 'reference') {
      addedNodes = [{
        tagName: 'SubTreePlus',
        content: { '@attributes': { ID: childSubtreeId, ...attributes } }
      }];
    } else {
      return res.status(400).send('Invalid mode');
    }

    const sequenceWrapper = {
      tagName: 'Sequence',
      content: {
        '@attributes': {
          ID: generateUniqueId('sequence_'),
          name: `Sequence_${childSubtreeId}`
        },
        '@children': addedNodes
      }
    };
    ensureUids(sequenceWrapper.content);
    parent['@children'].push(sequenceWrapper);

    await writeXML(mainTree);
    res.json({ success: true });
  } catch (err) {
    console.error('Error adding DO/DI subtree:', err);
    res.status(500).send('Failed to add DO/DI subtree');
  }
}

export const getRunPathSubtreesController = async (req, res) => {
  try {
    // Always force re-parse for Run Path to get fresh data
    const result = await readAndParseXML(RUNPATH_TEMPLATE_PATH, true); // <-- true = force re-parse

    const allChildren = Array.isArray(result['@children']) ? result['@children'] : [];

    const subtrees = allChildren
      .filter(c => c.tagName === 'BehaviorTree')
      .map(c => ({
        id: c.content['@attributes']?.ID,
      }));

    if (subtrees.length === 0)
      return res.status(200).json({ message: 'No Run Path subtrees found', subtrees: [] });

    res.json(subtrees);
  } catch (err) {
    console.error('Error in /getRunPathSubtrees:', err);
    res.status(500).json({ error: 'Failed to load Run Path subtrees' });
  }
}

export const getRunPathSubtreeByIdController = async (req, res) => {
  try {
    const result = await readAndParseXML(RUNPATH_TEMPLATE_PATH, true); // <-- true = force re-parse

    const subtree = result['@children']
      .find(c => c.tagName === 'BehaviorTree' && c.content['@attributes'].ID === req.params.id);
    if (!subtree) return res.status(404).send('Run Path Subtree not found');
    res.json({ root: { '@children': [subtree] } });
  } catch (err) {
    res.status(500).send('Failed to load Run Path subtree');
  }
}

export const addRunPathSubtreeAsChildController = async (req, res) => {
  const { subtreeId, parentPath, childSubtreeId, mode = 'full' } = req.body;

  try {
    const mainTree = await readAndParseXML();
    const runPathTree = await readAndParseXML(RUNPATH_TEMPLATE_PATH);

    const subtree = mainTree['@children']
      .find(c => c.tagName === 'BehaviorTree' && c.content['@attributes'].ID === subtreeId);
    if (!subtree) return res.status(404).send('Target subtree not found');

    const childTree = runPathTree['@children']
      .find(c => c.tagName === 'BehaviorTree' && c.content['@attributes'].ID === childSubtreeId);
    if (!childTree) return res.status(404).send('Run Path subtree not found');

    let parent = subtree.content;
    for (const id of parentPath) {
      const next = (parent['@children'] || [])
        .map(c => c.content)
        .find(c => c['@attributes']?._uid === id || c['@attributes']?.ID === id);
      if (!next) return res.status(400).send(`Invalid path: ${id}`);
      parent = next;
    }

    if (!parent['@children']) parent['@children'] = [];

    // Both modes are wrapped in a <Sequence> so multiple subtrees added at the
    // same level stay distinguishable.
    let addedNodes;
    if (mode === 'full') {
      const childCopy = JSON.parse(JSON.stringify(childTree));
      childCopy.content['@children'].forEach(child => {
        ensureUids(child.content);
      });
      addedNodes = childCopy.content['@children'];
    } else if (mode === 'reference') {
      const { attributes = {} } = req.body;

      const speed = parseFloat(attributes.desired_speed);
      if (isNaN(speed) || speed < 0.10 || speed > 2.00) {
        return res.status(400).send('desired_speed must be between 0.10 and 2.00');
      }

      addedNodes = [{
        tagName: 'SubTreePlus',
        content: {
          '@attributes': {
            ID: childSubtreeId,
            desired_speed: speed.toFixed(2)
          }
        }
      }];
    }
    else {
      return res.status(400).send('Invalid mode');
    }

    const sequenceWrapper = {
      tagName: 'Sequence',
      content: {
        '@attributes': {
          ID: generateUniqueId('sequence_'),
          name: `Sequence_${childSubtreeId}`
        },
        '@children': addedNodes
      }
    };
    ensureUids(sequenceWrapper.content);
    parent['@children'].push(sequenceWrapper);

    await writeXML(mainTree);
    res.json({ success: true });
  } catch (err) {
    console.error('Error adding Run Path subtree:', err);
    res.status(500).send('Failed to add Run Path subtree');
  }
}

export const getSubtreesController = async (req, res) => {
  try {
    const force = req.query.force_xml2js_parse === 'true';
    const result = await readAndParseXML(TEMPLATE_PATH, true);
    const allChildren = Array.isArray(result['@children']) ? result['@children'] : [];

    const subtrees = allChildren    
      .filter(c => c.tagName === 'BehaviorTree')
      .map(c => ({
        id: c.content['@attributes']?.ID || c.content['@attributes']?.id
      }));

    if (subtrees.length === 0) {
      return res.status(200).json({ message: 'No subtrees found', subtrees: [] });
    }

    res.json(subtrees);
  } catch (err) {
    console.error('Error in /getSubtrees:', err);
    res.status(500).send('Failed to load subtrees');
  }
}

export const getSubtreeByIdController = async (req, res) => {
  try {
    const result = await readAndParseXML(TEMPLATE_PATH, true); // ← force
    const subtree = result['@children']
      .find(c => c.tagName === 'BehaviorTree' && c.content['@attributes'].ID === req.params.id);

    if (!subtree) return res.status(404).send('Subtree not found');
    res.json({ root: { '@children': [subtree] } });
  } catch (err) {
    res.status(500).send('Failed to load subtree');
  }
}

export const addSubtreeController =  async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).send('Subtree name required');

  try {
    const result = await readAndParseXML();
    if (!result['@children']) result['@children'] = [];

    const newSubtree = {
      tagName: 'BehaviorTree',
      content: {
        '@attributes': { ID: `${name}` },
        '@children': [
          {
            tagName: 'Sequence',
            content: {
              '@attributes': {
                ID: generateUniqueId('seq_'),
                name: 'RootSequence'
              },
              '@children': []
            }
          }
        ]
      }
    };

    // assign _uid to the new subtree and its children
    ensureUids(newSubtree.content);

    result['@children'].push(newSubtree);
    await writeXML(result);
    res.json({ success: true, id: name });
  } catch (err) {
    console.error('addSubtree error:', err);
    res.status(500).send('Failed to add subtree');
  }
}

export const updateNodeController = async (req, res) => {
  const { subtreeId, nodePath, newAttributes } = req.body;

  try {
    const result = await readAndParseXML();
    const subtree = result['@children']
      .find(c => c.tagName === 'BehaviorTree' && c.content['@attributes'].ID === subtreeId);
    if (!subtree) return res.status(404).send('Subtree not found');

    let node = subtree.content;
    for (const uid of nodePath) {
      node = (node['@children'] || [])
        .map(c => c.content)
        .find(c =>
          c['@attributes']?._uid === uid ||
          c['@attributes']?.ID === uid
        );
      if (!node) return res.status(400).send(`Invalid path: ${uid}`);
    }

    node['@attributes'] = { ...node['@attributes'], ...newAttributes };

    ensureUids(result); // make sure new nodes get internal IDs if any were missing
    await writeXML(result);
    res.json({ success: true });
  } catch (err) {
    console.error('updateNode error:', err);
    res.status(500).send('Failed to update node');
  }
}

export const addNodeController = async (req, res) => {
  const { subtreeId, parentPath, nodeType, nodeName, attributes = {} } = req.body;
  if (!nodeType || !nodeName)
    return res.status(400).send('nodeType and nodeName required');

  try {
    console.log(`Node type: ${nodeType}, Node name: ${nodeName}`);

    const result = await readAndParseXML();

    // ---- find the target subtree ----
    const subtree = result['@children']
      .find(c => c.tagName === 'BehaviorTree' &&
        c.content['@attributes'].ID === subtreeId);
    if (!subtree) return res.status(404).send('Subtree not found');

    // ---- locate parent node using _uid path ----
    let parent = subtree.content;
    for (const uid of parentPath) {
      const next = (parent['@children'] || [])
        .map(c => c.content)
        .find(c =>
          c['@attributes']?._uid === uid ||
          c['@attributes']?.ID === uid
        );
      if (!next) return res.status(400).send(`Invalid path: ${uid}`);
      parent = next;
    }

    // ---- Load node definitions to check type ----
    const nodeDefs = await readNodeDefs();
    let isWrapper = false;
    let defaultChildren = [];

    console.log(`Searching for node type: ${nodeType}`);

    // Search for node type in categories structure
    if (nodeDefs.categories) {
      for (const categoryKey in nodeDefs.categories) {
        const category = nodeDefs.categories[categoryKey];
        if (category && category.nodes) {
          for (const nodeTypeKey in category.nodes) {
            const nodes = category.nodes[nodeTypeKey];
            if (nodes && nodes[nodeType]) {
              const def = nodes[nodeType];
              console.log(`Found ${nodeType} in ${categoryKey}.${nodeTypeKey}:`, def);
              isWrapper = def.type === 'wrapper';
              defaultChildren = def.children || [];
              break;
            }
          }
        }
        if (isWrapper) break;
      }
    }

    console.log(`Is wrapper? ${isWrapper}`);
    console.log(`Default children:`, defaultChildren);

    // ---- helper for creating sequences with proper UIDs ----
    const createSequence = (name) => {
      const seqId = generateUniqueId('seq_');
      return {
        tagName: 'Sequence',
        content: {
          '@attributes': {
            ID: seqId,
            name: name
          },
          '@children': []
        }
      };
    };

    // ---- create new node ----
    let newNode;

    if (isWrapper) {
      console.log(`Creating ${nodeType} as WRAPPER`);
      
      // Create children from default definition if specified
      const children = [];
      if (defaultChildren && defaultChildren.length > 0) {
        console.log(`Creating ${defaultChildren.length} default children`);
        for (const childDef of defaultChildren) {
          if (childDef.type === 'Sequence') {
            const sequence = createSequence(childDef.name || 'Sequence');
            children.push(sequence);
            console.log(`Created sequence: ${childDef.name}`);
          }
          // Add more child types here if needed (Parallel, WhileDoElse, etc.)
        }
      }

      newNode = {
        tagName: nodeType,
        content: {
          '@attributes': {
            ID: generateUniqueId(`${nodeType.toLowerCase()}_`),
            name: nodeName,
            ...attributes
          },
          '@children': children
        }
      };
      console.log(`Created ${nodeType} with ${children.length} children`);
    } else {
      console.log(`Creating ${nodeType} as LEAF`);
      // Leaf node
      newNode = {
        tagName: nodeType,
        content: {
          '@attributes': {
            ID: generateUniqueId(`${nodeType.toLowerCase()}_`),
            name: nodeName,
            ...attributes
          },
          '@children': []
        }
      };
    }


    // ---- assign _uid recursively (THIS IS CRITICAL for children) ----
    ensureUids(newNode.content);

    // ---- append to parent ----
    if (!parent['@children']) parent['@children'] = [];
    parent['@children'].push(newNode);

    // ---- save to file ----
    await writeXML(result);
    res.json({ success: true });
  } catch (err) {
    console.error('addNode error:', err);
    res.status(500).send('Failed to add node');
  }
};

export const deleteNodeController = async (req, res) => {
  const { subtreeId, nodePath } = req.body;

  try {
    const result = await readAndParseXML();
    const subtree = result['@children']
      .find(c => c.tagName === 'BehaviorTree' &&
        c.content['@attributes'].ID === subtreeId);
    if (!subtree) return res.status(404).send('Subtree not found');

    // navigate to parent
    let parent = subtree.content;
    for (let i = 0; i < nodePath.length - 1; i++) {
      const uid = nodePath[i];
      const next = (parent['@children'] || [])
        .map(c => c.content)
        .find(c =>
          c['@attributes']?._uid === uid ||
          c['@attributes']?.ID === uid
        );
      if (!next) return res.status(400).send(`Invalid path: ${uid}`);
      parent = next;
    }

    // remove target child
    const targetUid = nodePath[nodePath.length - 1];
    parent['@children'] = (parent['@children'] || [])
      .filter(c =>
        c.content['@attributes']?._uid !== targetUid &&
        c.content['@attributes']?.ID !== targetUid
      );

    ensureUids(result);
    await writeXML(result);
    res.json({ success: true });
  } catch (err) {
    console.error('deleteNode error:', err);
    res.status(500).send('Failed to delete node');
  }
}

export const deleteSubtreeController = async (req, res) => {
  const { subtreeId } = req.body;

  try {
    const result = await readAndParseXML();
    result['@children'] = result['@children']
      .filter(c => !(c.tagName === 'BehaviorTree' &&
        c.content['@attributes'].ID === subtreeId));
    await writeXML(result);
    res.json({ success: true });
  } catch (err) {
    console.error('deleteSubtree error:', err);
    res.status(500).send('Failed to delete subtree');
  }
}

export const addSubtreeAsChildController = async (req, res) => {
  const { subtreeId, parentPath, childSubtreeId, mode = 'full' } = req.body;

  try {
    const result = await readAndParseXML();

    // -------------------------------
    // Find target (current) subtree
    // -------------------------------
    const subtree = result['@children']
      .find(c =>
        c.tagName === 'BehaviorTree' &&
        c.content['@attributes'].ID === subtreeId
      );
    if (!subtree) {
      return res.status(404).send('Target subtree not found');
    }

    if (subtreeId === childSubtreeId) {
      return res.status(400).send('Cannot add subtree to itself');
    }

    // -------------------------------
    // Find child subtree definition
    // -------------------------------
    const childSubtree = result['@children']
      .find(c =>
        c.tagName === 'BehaviorTree' &&
        c.content['@attributes'].ID === childSubtreeId
      );
    if (!childSubtree) {
      return res.status(404).send('Child subtree not found');
    }

    // -------------------------------
    // Locate parent node using _uid path
    // -------------------------------
    let parent = subtree.content;
    for (const uid of parentPath) {
      const next = (parent['@children'] || [])
        .map(c => c.content)
        .find(c =>
          c['@attributes']?._uid === uid ||
          c['@attributes']?.ID === uid
        );

      if (!next) {
        return res.status(400).send(`Invalid parent path: ${uid}`);
      }
      parent = next;
    }

    if (!parent['@children']) parent['@children'] = [];

    // ==================================================
    // ⭐ HERE IS THE IMPORTANT PART (FULL vs REFERENCE)
    // ==================================================
    // Both modes are wrapped in a <Sequence> so that multiple subtrees added
    // at the same level stay visually/structurally distinguishable.
    let addedNodes;
    if (mode === 'reference') {
      // ---- <SubTreePlus> reference ----
      addedNodes = [{
        tagName: 'SubTreePlus',
        content: {
          '@attributes': {
            ID: childSubtreeId
          }
        }
      }];
    } else {
      // ---- FULL COPY ----
      const childCopy = JSON.parse(JSON.stringify(childSubtree));

      // Assign NEW _uid to all copied nodes
      (childCopy.content['@children'] || []).forEach(child => {
        ensureUids(child.content);
      });

      addedNodes = childCopy.content['@children'] || [];
    }

    const sequenceWrapper = {
      tagName: 'Sequence',
      content: {
        '@attributes': {
          ID: generateUniqueId('sequence_'),
          name: `Sequence_${childSubtreeId}`
        },
        '@children': addedNodes
      }
    };
    ensureUids(sequenceWrapper.content);
    parent['@children'].push(sequenceWrapper);

    // -------------------------------
    // Save result
    // -------------------------------
    await writeXML(result);
    res.json({ success: true });

  } catch (err) {
    console.error('addSubtreeAsChild error:', err);
    res.status(500).send('Failed to add subtree as child');
  }
}

export const deleteWrapperOnlyController = async (req, res) => {
  const { subtreeId, nodePath } = req.body;

  try {
    const result = await readAndParseXML();
    const subtree = result['@children']
      .find(c => c.tagName === 'BehaviorTree' &&
        c.content['@attributes'].ID === subtreeId);
    if (!subtree) return res.status(404).send('Subtree not found');

    const targetUid = nodePath[nodePath.length - 1];

    // locate parent
    let parent = subtree.content;
    for (let i = 0; i < nodePath.length - 1; i++) {
      const uid = nodePath[i];
      const next = (parent['@children'] || [])
        .map(c => c.content)
        .find(c =>
          c['@attributes']?._uid === uid ||
          c['@attributes']?.ID === uid
        );
      if (!next) return res.status(400).send(`Invalid path: ${uid}`);
      parent = next;
    }

    // find wrapper index
    const idx = (parent['@children'] || [])
      .findIndex(c =>
        c.content['@attributes']?._uid === targetUid ||
        c.content['@attributes']?.ID === targetUid
      );
    if (idx === -1) return res.status(400).send('Wrapper not found');

    const wrapper = parent['@children'][idx];
    const innerChildren = wrapper.content['@children'] || [];

    // replace wrapper with its children
    parent['@children'].splice(idx, 1, ...innerChildren);

    ensureUids(result);
    await writeXML(result);
    res.json({ success: true });
  } catch (err) {
    console.error('deleteWrapperOnly error:', err);
    res.status(500).send('Failed to delete wrapper');
  }
}

export const addWrapperController = async (req, res) => {
  const { subtreeId, nodePath, wrapperType } = req.body;

  try {
    const result = await readAndParseXML();
    const subtree = result['@children']
      .find(c => c.tagName === 'BehaviorTree' &&
        c.content['@attributes'].ID === subtreeId);
    if (!subtree) return res.status(404).send('Subtree not found');

    const wrapperTypes = ['Sequence', 'Fallback', 'Selector'];
    if (!wrapperTypes.includes(wrapperType))
      return res.status(400).send('Wrapper type invalid');

    const targetUid = nodePath[nodePath.length - 1];

    // locate parent
    let parent = subtree.content;
    for (let i = 0; i < nodePath.length - 1; i++) {
      const uid = nodePath[i];
      const next = (parent['@children'] || [])
        .map(c => c.content)
        .find(c =>
          c['@attributes']?._uid === uid ||
          c['@attributes']?.ID === uid
        );
      if (!next) return res.status(400).send(`Invalid path: ${uid}`);
      parent = next;
    }

    // locate target
    const idx = (parent['@children'] || [])
      .findIndex(c =>
        c.content['@attributes']?._uid === targetUid ||
        c.content['@attributes']?.ID === targetUid
      );
    if (idx === -1) return res.status(400).send('Target not found');

    const targetNode = parent['@children'][idx];
    const newWrapper = {
      tagName: wrapperType,
      content: {
        '@attributes': {
          ID: generateUniqueId(`${wrapperType.toLowerCase()}_`),
          name: `${wrapperType}_${targetNode.content['@attributes']?.name || 'wrapped'}`
        },
        '@children': [targetNode]
      }
    };

    ensureUids(newWrapper.content);
    parent['@children'].splice(idx, 1, newWrapper);

    await writeXML(result);
    res.json({ success: true });
  } catch (err) {
    console.error('addWrapper error:', err);
    res.status(500).send('Failed to add wrapper');
  }
}



export const swapNodesController = async (req, res) => {
  const { subtreeId, nodePath1, nodePath2 } = req.body;
  if (!subtreeId || !Array.isArray(nodePath1) || !Array.isArray(nodePath2))
    return res.status(400).send('subtreeId and node paths required');

  try {
    const result = await readAndParseXML();
    const subtree = result['@children']
      .find(c => c.tagName === 'BehaviorTree' &&
        c.content['@attributes'].ID === subtreeId);
    if (!subtree) return res.status(404).send('Subtree not found');

    // locate parent
    let parent = subtree.content;
    for (let i = 0; i < nodePath1.length - 1; i++) {
      const uid = nodePath1[i];
      const next = (parent['@children'] || [])
        .map(c => c.content)
        .find(c =>
          c['@attributes']?._uid === uid ||
          c['@attributes']?.ID === uid
        );
      if (!next) return res.status(400).send(`Invalid path: ${uid}`);
      parent = next;
    }

    const uid1 = nodePath1[nodePath1.length - 1];
    const uid2 = nodePath2[nodePath2.length - 1];
    const children = parent['@children'] || [];

    const idx1 = children.findIndex(c =>
      c.content['@attributes']?._uid === uid1 ||
      c.content['@attributes']?.ID === uid1
    );
    const idx2 = children.findIndex(c =>
      c.content['@attributes']?._uid === uid2 ||
      c.content['@attributes']?.ID === uid2
    );

    if (idx1 === -1 || idx2 === -1)
      return res.status(400).send('One or both nodes not found');

    [children[idx1], children[idx2]] = [children[idx2], children[idx1]];

    ensureUids(result);
    await writeXML(result);
    res.json({ success: true });
  } catch (err) {
    console.error('swapNodes error:', err);
    res.status(500).send('Failed to swap nodes');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ADD NODE AFTER — inserts a new node immediately after a chosen sibling.
//
// Body: { subtreeId, siblingPath, nodeType, nodeName, attributes? }
//   siblingPath  : _uid path to the node you want to insert AFTER (same as
//                  the path you'd pass to deleteNode for that node).
//
// The new node ends up at  siblingIndex + 1  inside the parent's @children,
// instead of always being pushed to the end like /addNode does.
// ─────────────────────────────────────────────────────────────────────────────
export const addNodeAfterController = async (req, res) => {
  const { subtreeId, siblingPath, nodeType, nodeName, attributes = {} } = req.body;
  if (!nodeType || !nodeName || !Array.isArray(siblingPath) || siblingPath.length === 0)
    return res.status(400).send('nodeType, nodeName and siblingPath required');

  try {
    const result = await readAndParseXML();

    const subtree = result['@children']
      .find(c => c.tagName === 'BehaviorTree' && c.content['@attributes'].ID === subtreeId);
    if (!subtree) return res.status(404).send('Subtree not found');

    // ── Navigate to PARENT of the sibling ────────────────────────
    let parent = subtree.content;
    for (let i = 0; i < siblingPath.length - 1; i++) {
      const uid = siblingPath[i];
      const next = (parent['@children'] || [])
        .map(c => c.content)
        .find(c => c['@attributes']?._uid === uid || c['@attributes']?.ID === uid);
      if (!next) return res.status(400).send(`Invalid path: ${uid}`);
      parent = next;
    }

    // ── Find sibling index ────────────────────────────────────────
    const siblingUid = siblingPath[siblingPath.length - 1];
    const children = parent['@children'] || [];
    const siblingIndex = children.findIndex(c =>
      c.content['@attributes']?._uid === siblingUid ||
      c.content['@attributes']?.ID === siblingUid
    );
    if (siblingIndex === -1) return res.status(400).send(`Sibling not found: ${siblingUid}`);

    // ── Look up node definition (wrapper vs leaf, default children) ──
    const nodeDefs = await readNodeDefs();
    let isWrapper = false;
    let defaultChildren = [];

    if (nodeDefs.categories) {
      outer: for (const catKey in nodeDefs.categories) {
        const cat = nodeDefs.categories[catKey];
        if (!cat?.nodes) continue;
        for (const ntKey in cat.nodes) {
          const nd = cat.nodes[ntKey]?.[nodeType];
          if (nd) {
            isWrapper = nd.type === 'wrapper';
            defaultChildren = nd.children || [];
            break outer;
          }
        }
      }
    }

    // ── Build default child sequences for wrappers ────────────────
    const makeSeq = (name) => ({
      tagName: 'Sequence',
      content: {
        '@attributes': { ID: generateUniqueId('seq_'), name },
        '@children': []
      }
    });

    const innerChildren = isWrapper
      ? defaultChildren
          .filter(c => c.type === 'Sequence')
          .map(c => makeSeq(c.name || 'Sequence'))
      : [];

    // ── Create the new node ───────────────────────────────────────
    const newNode = {
      tagName: nodeType,
      content: {
        '@attributes': {
          ID: generateUniqueId(`${nodeType.toLowerCase()}_`),
          name: nodeName,
          ...attributes
        },
        '@children': innerChildren
      }
    };

    ensureUids(newNode.content);

    // ── Splice in immediately AFTER the sibling ───────────────────
    if (!parent['@children']) parent['@children'] = [];
    parent['@children'].splice(siblingIndex + 1, 0, newNode);

    await writeXML(result);
    res.json({ success: true });
  } catch (err) {
    console.error('addNodeAfter error:', err);
    res.status(500).send('Failed to add node after');
  }
};

export const moveNodeAfterController =  async (req, res) => {
  const { subtreeId, sourcePath, targetPath } = req.body;
  if (!subtreeId || !Array.isArray(sourcePath) || !Array.isArray(targetPath))
    return res.status(400).send('subtreeId and node paths required');

  try {
    
    const result = await readAndParseXML();

    const subtree = result['@children']
      .find(c => c.tagName === 'BehaviorTree' &&
        c.content['@attributes'].ID === subtreeId);
    if (!subtree)
      return res.status(404).send('Subtree not found');

    // Locate common parent (both source and target have same parent)
    let parent = subtree.content;
    for (let i = 0; i < sourcePath.length - 1; i++) {
      const uid = sourcePath[i];
      const next = (parent['@children'] || [])
        .map(c => c.content)
        .find(c =>
          c['@attributes']?._uid === uid ||
          c['@attributes']?.ID === uid
        );
      if (!next) return res.status(400).send(`Invalid path: ${uid}`);
      parent = next;
    }

    const children = parent['@children'] || [];

    // Find indices
    const sourceUid = sourcePath[sourcePath.length - 1];
    const targetUid = targetPath[targetPath.length - 1];

    const srcIndex = children.findIndex(c =>
      c.content['@attributes']?._uid === sourceUid ||
      c.content['@attributes']?.ID === sourceUid
    );
    const targetIndex = children.findIndex(c =>
      c.content['@attributes']?._uid === targetUid ||
      c.content['@attributes']?.ID === targetUid
    );

    if (srcIndex === -1 || targetIndex === -1)
      return res.status(400).send('One or both nodes not found');

    // Safety: same node
    if (sourceUid === targetUid) {
      return res.status(400).send('Source and target cannot be the same');
    }

    // Safety: ensure both paths share same parent
    if (sourcePath.length !== targetPath.length ||
      sourcePath.slice(0, -1).join() !== targetPath.slice(0, -1).join()) {
      return res.status(400).send('Nodes must share the same parent');
    }

    // Remove and reinsert AFTER target
    const [moved] = children.splice(srcIndex, 1);
    // Adjust insertion index if removing before the target
    const insertIndex = srcIndex < targetIndex ? targetIndex : targetIndex + 1;
    children.splice(insertIndex, 0, moved);

    ensureUids(result);
    await writeXML(result);

    res.json({ success: true });
  } catch (err) {
    console.error('moveNodeAfter error:', err);
    res.status(500).send('Failed to move node');
  }
}

export const getTreeXMLController =  async (req, res) => {
  try {
    const { treeType } = req.body;
    
    if (!XML_MAP[treeType]) {
      return res.status(400).json({ message: 'Invalid tree type' });
    }
    
    const filePath = path.join(XML_BASE_DIR, XML_MAP[treeType]);
    const xmlText = await fs.readFile(filePath, 'utf8');
    const rootContent = parseXmlString(xmlText);
    stripInternalUids(rootContent);

    const xml = jsonToXml({ root: rootContent }, true);

    res.json({ xml, treeType });
  } catch (err) {
    console.error('❌ /getTreeXML error:', err);
    res.status(500).json({ message: err.message });
  }
}

export const copyNodeController = async (req, res) => {
  const { subtreeId, nodePath } = req.body;
  if (!subtreeId || !Array.isArray(nodePath) || nodePath.length === 0)
    return res.status(400).send('subtreeId and nodePath required');

  try {
    const result = await readAndParseXML();

    const subtree = result['@children']
      .find(c => c.tagName === 'BehaviorTree' &&
        c.content['@attributes'].ID === subtreeId);
    if (!subtree) return res.status(404).send('Subtree not found');

    // Navigate to parent
    let parent = subtree.content;
    for (let i = 0; i < nodePath.length - 1; i++) {
      const uid = nodePath[i];
      const next = (parent['@children'] || [])
        .map(c => c.content)
        .find(c =>
          c['@attributes']?._uid === uid ||
          c['@attributes']?.ID === uid
        );
      if (!next) return res.status(400).send(`Invalid path: ${uid}`);
      parent = next;
    }

    const targetUid = nodePath[nodePath.length - 1];
    const children = parent['@children'] || [];

    const originalIndex = children.findIndex(c =>
      c.content['@attributes']?._uid === targetUid ||
      c.content['@attributes']?.ID === targetUid
    );
    if (originalIndex === -1) return res.status(404).send('Node not found');

    // Reject copying any node that is — or contains, at any depth — a subtree
    // element. Duplicating subtree references/copies produces ambiguous trees.
    const SUBTREE_TAGS = ['SubTree', 'SubTreePlus'];
    function containsSubtree(node) {
      if (!node || typeof node !== 'object') return false;
      if (SUBTREE_TAGS.includes(node.tagName)) return true;
      const kids = node.content?.['@children'];
      if (Array.isArray(kids)) return kids.some(containsSubtree);
      return false;
    }
    if (containsSubtree(children[originalIndex])) {
      return res.status(400).send('cant copy a node with a subtree');
    }

    // Deep clone the node
    const clone = JSON.parse(JSON.stringify(children[originalIndex]));

    // Recursively regenerate all IDs and names in the clone,
    // and strip _uid so ensureUids() will mint fresh ones.
    function regenerateIds(node) {
      if (!node || typeof node !== 'object') return;
      const attrs = node['@attributes'];
      if (attrs) {
        // Regenerate the visible XML ID
        if (attrs.ID) {
          // Keep the type-prefix part before the first underscore+timestamp block
          const prefix = attrs.ID.replace(/_\d+_[a-z0-9]+$/, '');
          attrs.ID = generateUniqueId(`${prefix}_`);
        }
        // Append _copy to the human-readable name (avoid stacking on re-copies)
        if (attrs.name) {
          attrs.name = attrs.name.replace(/(_copy)+$/, '') + '_copy';
        }
        // Remove internal uid so ensureUids() will assign a fresh one
        delete attrs._uid;
      }
      if (Array.isArray(node['@children'])) {
        node['@children'].forEach(child => regenerateIds(child.content));
      }
    }

    regenerateIds(clone.content);
    ensureUids(clone.content);

    // Insert clone immediately after the original
    children.splice(originalIndex + 1, 0, clone);

    await writeXML(result);
    res.json({ success: true });
  } catch (err) {
    console.error('copyNode error:', err);
    res.status(500).send('Failed to copy node');
  }
}