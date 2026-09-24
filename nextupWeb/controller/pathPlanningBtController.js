import fs from "fs";
import yaml from "js-yaml";
import { buildXML, fileExists, findRootPlanSequence, loadXML, saveXML, swapWithBackup } from "../service/pathPlanningBtService.js";
import { pathPlanningFilePath, pointPlanningFilePath } from "../config/path.js";

const pointsYamlFilePath = pointPlanningFilePath.POINTS_YAML_FILE;

const pathsYamlFile = pathPlanningFilePath.PATHS_YAML_FILE;

const XML_BACKUP_FILE = pathPlanningFilePath.PATH_PLAN_TREE_XML_BACKUP_FILE;



export const undoController =  async (req, res) => {
    try {
        await swapWithBackup();
        const data = await loadXML();

        return res.json({
            message: 'Undo successful',
            xml: buildXML(data)
        });
    } catch (err) {
        console.error('Error in /undo:', err);
        return res.status(500).json({ message: err.message });
    }
}

export const canUndoController = async (req, res) => {
    try {
        const canUndo = fileExists(XML_BACKUP_FILE);
        return res.json({ canUndo });
    } catch (err) {
        console.error('Error in /canUndo:', err);
        return res.status(500).json({ message: err.message });
    }
}

export const getPointNamesController = async (req, res) => {
    try {
        const pointsYamlFile = await fs.promises.readFile(pointsYamlFilePath, 'utf8');
        const parsed = yaml.load(pointsYamlFile);
        const points = (parsed?.points ?? []).map(p => p.name);
        res.json(points);
    } catch (err) {
        console.error('Error in /getPointNames:', err);
        res.status(500).json({ message: 'Error reading points YAML' });
    }
}

export const getPathNamesController = async (req, res) => {
    try {
        await fs.promises.access(pathsYamlFile, fs.constants.R_OK);
        const file = await fs.promises.readFile(pathsYamlFile, 'utf8');
        // console.log(`Read ${pathsYamlFile}, content: ${file.slice(0, 100)}...`);
        const parsed = yaml.load(file);
        // console.log(`Parsed YAML: ${JSON.stringify(parsed, null, 2).slice(0, 100)}...`);
        const paths = parsed.paths ? parsed.paths.map(p => p.name) : [];
        res.json(paths);
    } catch (err) {
        console.error(`Error in /getPathNames for ${pathsYamlFile}:`, err);
        res.status(500).json({ message: `Error reading paths YAML: ${err.message}` });
    }
}

export const getPathsYAMLController = async (req, res) => {
    try {
        await fs.promises.access(pathsYamlFile, fs.constants.R_OK);
        console.log(`${pathsYamlFile} is accessible`);
        const file = await fs.promises.readFile(pathsYamlFile, 'utf8');
        const parsed = yaml.load(file);
        const paths = parsed.paths || [];
        console.log(`Returning full paths YAML data`);
        res.json({ paths });
    } catch (err) {
        console.error(`Error in /getPathsYAML for ${pathsYamlFile}:`, err);
        res.status(500).json({ message: `Error reading paths YAML: ${err.message}` });
    }
}

export const getOriginPointFileNameController = async (req, res) => {
    try {
        await fs.promises.access(pathsYamlFile, fs.constants.R_OK);
        console.log(`${pathsYamlFile} is accessible`);
        const file = await fs.promises.readFile(pathsYamlFile, 'utf8');
        const parsed = yaml.load(file);
        const originPointFileName = parsed.points_file_name || '';
        console.log(`Returning origin_point_file_name: ${originPointFileName}`);
        res.json({ originPointFileName });
    } catch (err) {
        console.error(`Error in /getOriginPointFileName for ${pathsYamlFile}:`, err);
        res.status(500).json({ message: `Error reading paths YAML: ${err.message}` });
    }
}

export const getPointFileNameController = async (req, res) => {
    try {
        console.log(`Attempting to access ${pointsYamlFilePath}`);
        await fs.promises.access(pointsYamlFilePath, fs.constants.R_OK);

        const file = await fs.promises.readFile(pointsYamlFilePath, 'utf8');
        const parsed = yaml.load(file);

        const pointFileName = parsed.points_file_name || '';

        console.log(`Returning point_file_name: ${pointFileName}`);
        res.json({ pointFileName });

    } catch (err) {
        console.error(`Error in /getPointFileName for ${pointsYamlFilePath}:`, err);
        res.status(500).json({ message: `Error reading points YAML: ${err.message}` });
    }
}

export const getXMLController = async (req, res) => {
    try {
        const data = await loadXML();
        return res.json({ xml: buildXML(data) });
    } catch (err) {
        console.error('Error in /getXML:', err);
        return res.status(500).json({ message: err.message });
    }
}

export const getTreeDataController =  async (req, res) => {
    try {
        const data = await loadXML();
        const target = findRootPlanSequence(data);
        if (!target || !target.Sequence) {
            return res.json([]);
        }

        const sequences = Array.isArray(target.Sequence) ? target.Sequence : [target.Sequence];
        const blocks = sequences.map(seq => {
            if (seq.Fallback?.Sequence?.[0]?.PlanPath) {
                const plan = seq.Fallback.Sequence[0].PlanPath.$;
                return {
                    type: 'planPath',
                    name: seq.$.name,
                    startPoint: plan.start_goal,
                    goalPoint: plan.end_goal,
                    planSpace: plan.plan_space,
                    pathName: plan.path_name,
                    intermediateGoal: plan.intermediate_goal || ''
                };
            }
            return null;
        }).filter(Boolean);

        res.json(blocks);
    } catch (err) {
        console.error('Error in /getTreeData:', err);
        res.status(500).json({ message: err.message });
    }
}

export const addPlanPathController = async (req, res) => {
    try {
        const { startPoint, goalPoint, planSpace, pathName, intermediateGoal = '' } = req.body;

        if (!startPoint || !goalPoint || !planSpace || !pathName) {
            return res.status(400).json({ message: 'Missing required fields: startPoint, goalPoint, planSpace, pathName' });
        }

        const data = await loadXML();
        const target = findRootPlanSequence(data);
        if (!target) {
            return res.status(404).json({ message: 'root_plan_sequence not found' });
        }

        if (!target.Sequence) target.Sequence = [];
        if (!Array.isArray(target.Sequence)) target.Sequence = [target.Sequence];

        const fullPathName = `plan_${pathName}`;
        if (target.Sequence.some(seq => seq.$.name === fullPathName)) {
            return res.status(400).json({ message: `Sequence ${fullPathName} already exists` });
        }

        const newSeq = {
            $: { name: fullPathName },
            Fallback: {
                Sequence: [
                    {
                        Sequence: [
                            {
                                MsgLoggerNode: {
                                    $: { msg_log: `[MOTION-PLAN] Initiating ${planSpace}-space path planning: start=${startPoint}, goal=${goalPoint}, path=${pathName}${intermediateGoal ? `, intermediate=${intermediateGoal}` : ''}` }
                                },
                                PopupMsg: {
                                    $: { msg: `Planning Path: ${startPoint} → ${goalPoint}${intermediateGoal ? ` via ${intermediateGoal}` : ''}`, type: 'warn', timeout: '10' }
                                }
                            }
                        ],
                        PlanPath: {
                            $: {
                                start_goal: startPoint,
                                end_goal: goalPoint,
                                plan_space: planSpace,
                                path_name: pathName,
                                ...(intermediateGoal && { intermediate_goal: intermediateGoal })
                            }
                        },
                        MsgLoggerNode: {
                            $: { msg_log: `[MOTION-PLAN] Successfully planned ${planSpace}-space path: start=${startPoint}, goal=${goalPoint}, path=${pathName}${intermediateGoal ? `, intermediate=${intermediateGoal}` : ''}` }
                        },
                        PopupMsg: {
                            $: { msg: `Path Planning Successful: ${startPoint} → ${goalPoint}${intermediateGoal ? ` via ${intermediateGoal}` : ''}`, type: 'success', timeout: '10' }
                        },
                        Sleep: { $: { msec: '300' } }
                    },
                    {
                        Sequence: [
                            {
                                MsgLoggerNode: {
                                    $: { msg_log: `[MOTION-PLAN] Path planning FAILED in ${planSpace} space: start=${startPoint}, goal=${goalPoint}, path=${pathName}${intermediateGoal ? `, intermediate=${intermediateGoal}` : ''}` }
                                },
                                PopupMsg: {
                                    $: { msg: `Path Planning Failed: ${startPoint} → ${goalPoint}${intermediateGoal ? ` via ${intermediateGoal}` : ''}`, type: 'failure', timeout: '0' }
                                }
                            },
                            {
                                MsgLoggerNode: {
                                    $: { msg_log: '[MOTION-PLAN] Shutting down motion planning node due to planning failure.' }
                                }
                            }
                        ],
                        ShutdownNode: {},
                        MsgLoggerNode: {
                            $: { msg_log: '[MOTION-PLAN] Please review the planning parameters/control flow and restart motion planning.' }
                        },
                        PublishDataOnTopic: {
                            $: { type_of_topic: 'std_msgs/msg/String', msg_on_topic: 'stop', topic_name: '/control_process_motion_bt' }
                        },
                        AlwaysFailure: {}
                    }
                ]
            }
        };

        target.Sequence.push(newSeq);
        await saveXML(data);
        return res.json({ message: `Added ${fullPathName}`, xml: buildXML(data) });
    } catch (err) {
        console.error('Error in /addPlanPath:', err);
        return res.status(500).json({ message: err.message });
    }
}

export const updatePlanPathController = async (req, res) => {
    try {
        const { oldPathName, newPathName, startPoint, goalPoint, planSpace, intermediateGoal = '' } = req.body;
        if (!oldPathName || !newPathName || !startPoint || !goalPoint || !planSpace) {
            return res.status(400).json({ message: 'Missing required fields: oldPathName, newPathName, startPoint, goalPoint, planSpace' });
        }

        const data = await loadXML();
        const target = findRootPlanSequence(data);
        if (!target) {
            return res.status(404).json({ message: 'root_plan_sequence not found' });
        }

        if (!Array.isArray(target.Sequence)) target.Sequence = [target.Sequence];

        const oldFullPathName = oldPathName.startsWith('plan_') ? oldPathName : `plan_${oldPathName}`;
        const seqIndex = target.Sequence.findIndex(seq => seq.$.name === oldFullPathName);
        if (seqIndex === -1) {
            return res.status(404).json({ message: `Sequence ${oldFullPathName} not found` });
        }

        const newFullPathName = `plan_${newPathName}`;
        if (newFullPathName !== oldFullPathName && target.Sequence.some(seq => seq.$.name === newFullPathName)) {
            return res.status(400).json({ message: `Sequence ${newFullPathName} already exists` });
        }

        target.Sequence[seqIndex] = {
            $: { name: newFullPathName },
            Fallback: {
                Sequence: [
                    {
                        Sequence: [
                            {
                                MsgLoggerNode: {
                                    $: { msg_log: `[MOTION-PLAN] Initiating ${planSpace}-space path planning: start=${startPoint}, goal=${goalPoint}, path=${newPathName}${intermediateGoal ? `, intermediate=${intermediateGoal}` : ''}` }
                                },
                                PopupMsg: {
                                    $: { msg: `Planning Path: ${startPoint} → ${goalPoint}${intermediateGoal ? ` via ${intermediateGoal}` : ''}`, type: 'warn', timeout: '10' }
                                }
                            }
                        ],
                        PlanPath: {
                            $: {
                                start_goal: startPoint,
                                end_goal: goalPoint,
                                plan_space: planSpace,
                                path_name: newPathName,
                                ...(intermediateGoal && { intermediate_goal: intermediateGoal })
                            }
                        },
                        MsgLoggerNode: {
                            $: { msg_log: `[MOTION-PLAN] Successfully planned ${planSpace}-space path: start=${startPoint}, goal=${goalPoint}, path=${newPathName}${intermediateGoal ? `, intermediate=${intermediateGoal}` : ''}` }
                        },
                        PopupMsg: {
                            $: { msg: `Path Planning Successful: ${startPoint} → ${goalPoint}${intermediateGoal ? ` via ${intermediateGoal}` : ''}`, type: 'success', timeout: '10' }
                        },
                        Sleep: { $: { msec: '300' } }
                    },
                    {
                        Sequence: [
                            {
                                MsgLoggerNode: {
                                    $: { msg_log: `[MOTION-PLAN] Path planning FAILED in ${planSpace} space: start=${startPoint}, goal=${goalPoint}, path=${newPathName}${intermediateGoal ? `, intermediate=${intermediateGoal}` : ''}` }
                                },
                                PopupMsg: {
                                    $: { msg: `Path Planning Failed: ${startPoint} → ${goalPoint}${intermediateGoal ? ` via ${intermediateGoal}` : ''}`, type: 'failure', timeout: '0' }
                                }
                            },
                            {
                                MsgLoggerNode: {
                                    $: { msg_log: '[MOTION-PLAN] Shutting down motion planning node due to planning failure.' }
                                }
                            }
                        ],
                        ShutdownNode: {},
                        MsgLoggerNode: {
                            $: { msg_log: '[MOTION-PLAN] Please review the planning parameters/control flow and restart motion planning.' }
                        },
                        PublishDataOnTopic: {
                            $: { type_of_topic: 'std_msgs/msg/String', msg_on_topic: 'stop', topic_name: '/control_process_motion_bt' }
                        },
                        AlwaysFailure: {}
                    }
                ]
            }
        };

        await saveXML(data);
        return res.json({ message: `Updated ${oldFullPathName} to ${newFullPathName}`, xml: buildXML(data) });
    } catch (err) {
        console.error('Error in /updatePlanPath:', err);
        return res.status(500).json({ message: err.message });
    }
}

export const deletePathController = async (req, res) => {
    try {
        const { pathName } = req.body;
        if (!pathName) {
            return res.status(400).json({ message: 'Missing pathName' });
        }

        const data = await loadXML();
        const target = findRootPlanSequence(data);
        if (!target) {
            return res.status(404).json({ message: 'root_plan_sequence not found' });
        }

        if (!Array.isArray(target.Sequence)) target.Sequence = [target.Sequence];

        const fullPathName = pathName.startsWith('plan_') ? pathName : `plan_${pathName}`;
        const initialLength = target.Sequence.length;
        target.Sequence = target.Sequence.filter(seq => seq.$.name !== fullPathName);

        if (target.Sequence.length === initialLength) {
            return res.status(404).json({ message: `Sequence ${fullPathName} not found` });
        }

        if (target.Sequence.length === 0) delete target.Sequence;

        await saveXML(data);
        return res.json({ message: `Deleted sequence: ${fullPathName}`, xml: buildXML(data) });
    } catch (err) {
        console.error('Error in /deletePath:', err);
        return res.status(500).json({ message: err.message });
    }
}

export const deleteLastController = async (req, res) => {
    try {
        const data = await loadXML();
        const target = findRootPlanSequence(data);
        if (!target) {
            return res.status(404).json({ message: 'root_plan_sequence not found' });
        }

        if (!Array.isArray(target.Sequence)) target.Sequence = [target.Sequence];

        if (!target.Sequence || target.Sequence.length === 0) {
            return res.status(400).json({ message: 'No sequences to delete' });
        }

        target.Sequence.pop();

        if (target.Sequence.length === 0) delete target.Sequence;

        await saveXML(data);
        return res.json({ message: 'Deleted last sequence', xml: buildXML(data) });
    } catch (err) {
        console.error('Error in /deleteLast:', err);
        return res.status(500).json({ message: err.message });
    }
}

export const deleteAllController = async (req, res) => {
    try {
        const data = await loadXML();
        const target = findRootPlanSequence(data);
        if (!target) {
            return res.status(404).json({ message: 'root_plan_sequence not found' });
        }

        // Check if Sequence exists and is not empty
        if (!target.Sequence || target.Sequence.length === 0) {
            return res.status(400).json({ message: 'No sequences to delete' });
        }

        delete target.Sequence;

        await saveXML(data);
        return res.json({ message: 'Deleted all sequences', xml: buildXML(data) });
    } catch (err) {
        console.error('Error in /deleteAll:', err);
        return res.status(500).json({ message: err.message });
    }
}

export const reorderSequencesController =  async (req, res) => {
    try {
        const { sequenceNames } = req.body;
        if (!Array.isArray(sequenceNames) || sequenceNames.length === 0) {
            return res.status(400).json({ message: 'sequenceNames must be a non-empty array' });
        }

        const data = await loadXML();
        const target = findRootPlanSequence(data);
        if (!target) {
            return res.status(404).json({ message: 'root_plan_sequence not found' });
        }

        if (!Array.isArray(target.Sequence)) target.Sequence = [target.Sequence];

        const sequenceMap = new Map();
        target.Sequence.forEach(seq => {
            if (seq.$?.name) sequenceMap.set(seq.$.name, seq);
        });

        const invalidNames = sequenceNames.filter(name => !sequenceMap.has(name));
        if (invalidNames.length > 0) {
            return res.status(404).json({ message: `Sequences not found: ${invalidNames.join(', ')}` });
        }

        target.Sequence = sequenceNames.map(name => sequenceMap.get(name));

        await saveXML(data);
        return res.json({ message: 'Sequences reordered successfully', xml: buildXML(data) });
    } catch (err) {
        console.error('Error in /reorderSequences:', err);
        return res.status(500).json({ message: err.message });
    }
}