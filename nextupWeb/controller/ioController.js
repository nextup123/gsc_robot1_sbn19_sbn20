
import { ioFilePath } from '../config/path.js';
import { buildXML, fileExists, loadXML, saveXML, swapWithBackup } from '../service/ioService.js';

const XML_BACKUP_FILE = ioFilePath.DO_DI_TREE_XML_BACKUP_FILE;


export const undoController = async (req, res) => {
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
        const canUndo = await fileExists(XML_BACKUP_FILE);
        return res.json({ canUndo });
    } catch (err) {
        console.error('Error in /canUndo:', err);
        return res.status(500).json({ message: err.message });
    }
}


export const getXmlController = async (req, res) => {
    try {
        const data = await loadXML();
        return res.json({ xml: buildXML(data) });
    } catch (err) {
        console.error('Error in /getXML:', err);
        return res.status(500).json({ message: err.message });
    }
}

export const getTreeDataController = async (req, res) => {
    try {
        const data = await loadXML();

        if (!data.root.BehaviorTree || Object.keys(data.root.BehaviorTree).length === 0) {
            return res.json([]);
        }

        const trees = Array.isArray(data.root.BehaviorTree)
            ? data.root.BehaviorTree
            : [data.root.BehaviorTree];

        const sequences = trees.map(tree => {

            /* ===================== DO (unchanged) ===================== */
            if (tree.Sequence && tree.Sequence.DoControl) {
                const control = tree.Sequence.DoControl.$;

                return {
                    type: 'DO',
                    name: tree.$.ID,
                    driverId: control.driver_id,
                    doId: control.do_id,
                    controlType: control.type_of_control,
                    pushWait: control.push_wait,
                    responseMsg:
                        tree.Sequence.Sequence?.MsgLogger?.$?.msg_log || ''
                };
            }

            /* ===================== GpioDoControl ===================== */
            if (tree.Sequence && tree.Sequence.GpioDoControl) {
                const control = tree.Sequence.GpioDoControl.$;

                return {
                    type: 'GpioDoControl',
                    name: tree.$.ID,
                    gpioId: control.gpio_id,
                    doId: control.do_id,
                    controlType: control.type_of_control,
                    pushWait: control.push_wait,
                    responseMsg:
                        tree.Sequence.Sequence?.MsgLogger?.$?.msg_log || ''
                };
            }

            /* ===================== DI (OLD STYLE) ===================== */
            if (tree.Sequence && tree.Sequence.DIControl) {
                const control = tree.Sequence.DIControl.$;

                return {
                    type: 'DI',
                    name: tree.$.ID,
                    driverId: control.driver_id,
                    diId: control.di_id,
                    waitTime: control.wait_time || null,
                    responseMsg:
                        tree.Sequence.Sequence?.MsgLogger?.$?.msg_log || '',
                    with_fallback: false
                };
            }
            /* ===================== GpioDiControl (no fallback) ===================== */
            if (tree.Sequence && tree.Sequence.GpioDiControl) {
                const control = tree.Sequence.GpioDiControl.$;

                return {
                    type: 'GpioDiControl',
                    name: tree.$.ID,
                    gpioId: control.gpio_id,
                    diId: control.di_id,
                    waitTime: control.wait_time || null,
                    responseMsg:
                        tree.Sequence.Sequence?.MsgLogger?.$?.msg_log || '',
                    with_fallback: false
                };
            }
            /* ===================== DI / GpioDiControl (FALLBACK STYLE) ===================== */
            if (tree.Fallback && tree.Fallback.Sequence) {
                const sequences = Array.isArray(tree.Fallback.Sequence)
                    ? tree.Fallback.Sequence
                    : [tree.Fallback.Sequence];

                // Success path = sequence that contains DIControl or GpioDiControl
                const successSeq = sequences.find(seq => seq.DIControl || seq.GpioDiControl);

                if (!successSeq) return null;

                if (successSeq.GpioDiControl) {
                    const control = successSeq.GpioDiControl.$;
                    return {
                        type: 'GpioDiControl',
                        name: tree.$.ID,
                        gpioId: control.gpio_id,
                        diId: control.di_id,
                        waitTime: control.wait_time || null,
                        responseMsg:
                            successSeq.Sequence?.MsgLogger?.$?.msg_log || '',
                        with_fallback: true
                    };
                }

                const control = successSeq.DIControl.$;

                return {
                    type: 'DI',
                    name: tree.$.ID,
                    driverId: control.driver_id,
                    diId: control.di_id,
                    waitTime: control.wait_time || null,
                    responseMsg:
                        successSeq.Sequence?.MsgLogger?.$?.msg_log || '',
                    with_fallback: true
                };
            }

            return null;
        }).filter(Boolean);

        res.json(sequences);

    } catch (err) {
        console.error('Error in /getTreeData:', err);
        res.status(500).json({ message: err.message });
    }
}

export const getControlByNameController = async (req, res) => {
    try {
        const data = await loadXML();

        const trees = Array.isArray(data.root.BehaviorTree)
            ? data.root.BehaviorTree
            : (data.root.BehaviorTree ? [data.root.BehaviorTree] : []);

        const control = trees.find(tree => tree.$.ID === req.params.name);
        if (!control) {
            return res.status(404).json({ message: `Control ${req.params.name} not found` });
        }

        /* ===================== DO ===================== */
        if (control.Sequence && control.Sequence.DoControl) {
            const ctrl = control.Sequence.DoControl.$;

            return res.json({
                type: 'DO',
                name: control.$.ID,
                driverId: ctrl.driver_id,
                doId: ctrl.do_id,
                controlType: ctrl.type_of_control,
                pushWait: ctrl.push_wait,
                responseMsg:
                    control.Sequence.Sequence?.MsgLogger?.$?.msg_log || ''
            });
        }

        if (control.Sequence && control.Sequence.GpioDoControl) {
            const ctrl = control.Sequence.GpioDoControl.$;

            return res.json({
                type: 'GpioDoControl',
                name: control.$.ID,
                gpioId: ctrl.gpio_id,
                doId: ctrl.do_id,
                controlType: ctrl.type_of_control,
                pushWait: ctrl.push_wait,
                responseMsg:
                    control.Sequence.Sequence?.MsgLogger?.$?.msg_log || ''
            });
        }
        /* ===================== DI (OLD STYLE) ===================== */
        if (control.Sequence && control.Sequence.DIControl) {
            const ctrl = control.Sequence.DIControl.$;

            return res.json({
                type: 'DI',
                name: control.$.ID,
                driverId: ctrl.driver_id,
                diId: ctrl.di_id,
                waitTime: ctrl.wait_time || null,
                responseMsg:
                    control.Sequence.Sequence?.MsgLogger?.$?.msg_log || '',
                with_fallback: false
            });
        }
         /* ===================== GpioDiControl (no fallback) ===================== */
        if (control.Sequence && control.Sequence.GpioDiControl) {
            const ctrl = control.Sequence.GpioDiControl.$;

            return res.json({
                type: 'GpioDiControl',
                name: control.$.ID,
                gpioId: ctrl.gpio_id,
                diId: ctrl.di_id,
                waitTime: ctrl.wait_time || null,
                responseMsg:
                    control.Sequence.Sequence?.MsgLogger?.$?.msg_log || '',
                with_fallback: false
            });
        }
        /* ===================== DI (FALLBACK STYLE) ===================== */
        if (control.Fallback && control.Fallback.Sequence) {
            const sequences = Array.isArray(control.Fallback.Sequence)
                ? control.Fallback.Sequence
                : [control.Fallback.Sequence];

                const successSeq = sequences.find(seq => seq.DIControl || seq.GpioDiControl);

            if (!successSeq) {
                return res.status(404).json({
                    message: `Control ${req.params.name} has no valid DI success sequence`
                });
            }

            if (successSeq.GpioDiControl) {
                const ctrl = successSeq.GpioDiControl.$;
                return res.json({
                    type: 'GpioDiControl',
                    name: control.$.ID,
                    gpioId: ctrl.gpio_id,
                    diId: ctrl.di_id,
                    waitTime: ctrl.wait_time || null,
                    responseMsg:
                        successSeq.Sequence?.MsgLogger?.$?.msg_log || '',
                    with_fallback: true
                });
            }

            const ctrl = successSeq.DIControl.$;

            return res.json({
                type: 'DI',
                name: control.$.ID,
                driverId: ctrl.driver_id,
                diId: ctrl.di_id,
                waitTime: ctrl.wait_time || null,
                responseMsg:
                    successSeq.Sequence?.MsgLogger?.$?.msg_log || '',
                with_fallback: true
            });
        }

        return res.status(404).json({ message: `Control ${req.params.name} not found` });

    } catch (err) {
        console.error('Error in /getControl:', err);
        return res.status(500).json({ message: err.message });
    }
}


export const addControlController = async (req, res) => {
    try {
        const {
            type,
            name,
            driverId,
            gpioId,
            doId,
            diId,
            controlType,
            pushWait,
            waitTime,
            responseMsg,
            with_fallback
        } = req.body;

        const isGpio = type === 'GpioDoControl' || type === 'GpioDiControl';
        const controllerId = isGpio ? gpioId : driverId;

        // ---------------- VALIDATION ----------------
        if (
            !type ||
            !name ||
            !controllerId ||
            !responseMsg ||
            !/^[A-Za-z0-9]+(\[(DO|DI)\])?$/.test(name)
        ) {
            return res.status(400).json({ message: '1 Missing or invalid required fields' });
        }

        if ((type === 'DO' || type === 'GpioDoControl') && (!doId || !controlType)) {
            return res.status(400).json({ message: '2 Missing DO required fields' });
        }

        if ((type === 'DI' || type === 'GpioDiControl') && !diId) {
            return res.status(400).json({ message: '3 Missing DI required fields' });
        }
        // ---------------- LOAD XML ----------------
        const data = await loadXML();

        let trees = Array.isArray(data.root.BehaviorTree)
            ? data.root.BehaviorTree
            : (data.root.BehaviorTree ? [data.root.BehaviorTree] : []);

        if (trees.some(tree => tree.$.ID === name)) {
            return res.status(400).json({ message: `Control ${name} already exists` });
        }

        // ---------------- DO TREE ----------------
        const doTree = {
            $: { ID: name },
            Sequence: {
                $: { ID: 'seq_1' },
                MsgLogger: {
                    $: { ID: 'msg_1', msg_log: `${name} subtree starting...` }
                },
                DoControl: {
                    $: {
                        ID: 'ctrl_1',
                        name,
                        driver_id: driverId,
                        do_id: doId,
                        control_name: name,
                        type_of_control: controlType,
                        expected_action: '{expected_action}',
                        ...(pushWait !== undefined && { push_wait: pushWait })
                    }
                },
                Sequence: {
                    $: { ID: `seq_2` },
                    MsgLogger: { $: { ID: `msg_2`, msg_log: responseMsg } }
                }
            }
        };

        // ---------------- DI SUCCESS SEQUENCE ----------------
        const diSuccessSequence = {
            $: { ID: 'success_seq' },
            MsgLogger: {
                $: { ID: 'msg_1', msg_log: `${name} subtree starting...` }
            },
            DIControl: {
                $: {
                    ID: 'ctrl_1',
                    name,
                    driver_id: driverId,
                    di_id: diId,
                    status_name: name,
                    expected_status: '{expected_status}',
                    ...(waitTime && { wait_time: waitTime })
                }
            },
            Sequence: {
                $: { ID: `seq_2` },
                MsgLogger: { $: { ID: `msg_2`, msg_log: responseMsg } }
            }
            // ,
            // MsgPopup: {
            //     $: {
            //         ID: 'pop_1',
            //         msg: `${name} sensing successful`,
            //         type: 'success',
            //         timeout: '3'
            //     }
            // }
        };

        // ---------------- DI TREE (NO FALLBACK) ----------------
        const diTreeNormal = {
            $: { ID: name },
            Sequence: diSuccessSequence
        };

       // ---------------- DI TREE (WITH FALLBACK) ----------------
        const diTreeWithFallback = {
            $: { ID: name },
            Fallback: {
                Sequence: [
                    diSuccessSequence,
                    {
                        $: { ID: 'failure_seq' },
                        MsgPopup: {
                            $: { ID: 'pop_fail', msg: `${name} sensing failed`, type: 'failure', timeout: '0' }
                        },
                        MsgLogger: { $: { ID: 'msg_fail', msg_log: `${name} sensing failed` } },
                        AlwaysFailure: {}
                    }
                ]
            }
        };

        // ---------------- GpioDoControl TREE ----------------
        const gpioDoTree = {
            $: { ID: name },
            Sequence: {
                $: { ID: 'seq_1' },
                MsgLogger: { $: { ID: 'msg_1', msg_log: `${name} subtree starting...` } },
                GpioDoControl: {
                    $: {
                        ID: 'ctrl_1',
                        name,
                        gpio_id: gpioId,
                        do_id: doId,
                        control_name: name,
                        type_of_control: controlType,
                        expected_action: '{expected_action}',
                        ...(pushWait !== undefined && { push_wait: pushWait })
                    }
                },
                Sequence: { $: { ID: 'seq_2' }, MsgLogger: { $: { ID: 'msg_2', msg_log: responseMsg } } }
            }
        };

        // ---------------- GpioDiControl SUCCESS SEQUENCE ----------------
        const gpioDiSuccessSequence = {
            $: { ID: 'success_seq' },
            MsgLogger: { $: { ID: 'msg_1', msg_log: `${name} subtree starting...` } },
            GpioDiControl: {
                $: {
                    ID: 'ctrl_1',
                    name,
                    gpio_id: gpioId,
                    di_id: diId,
                    status_name: name,
                    expected_status: '{expected_status}',
                    ...(waitTime && { wait_time: waitTime })
                }
            },
            Sequence: { $: { ID: 'seq_2' }, MsgLogger: { $: { ID: 'msg_2', msg_log: responseMsg } } }
        };

        // ---------------- GpioDiControl TREE (NO FALLBACK) ----------------
        const gpioDiTreeNormal = { $: { ID: name }, Sequence: gpioDiSuccessSequence };

        // ---------------- GpioDiControl TREE (WITH FALLBACK) ----------------
        const gpioDiTreeWithFallback = {
            $: { ID: name },
            Fallback: {
                Sequence: [
                    gpioDiSuccessSequence,
                    {
                        $: { ID: 'failure_seq' },
                        MsgPopup: {
                            $: { ID: 'pop_fail', msg: `${name} sensing failed`, type: 'failure', timeout: '0' }
                        },
                        MsgLogger: { $: { ID: 'msg_fail', msg_log: `${name} sensing failed` } },
                        AlwaysFailure: {}
                    }
                ]
            }
        };

        // ---------------- FINAL TREE SELECTION ----------------
        let newTree;
        if (type === 'DO') {
            newTree = doTree;
        } else if (type === 'GpioDoControl') {
            newTree = gpioDoTree;
        } else if (type === 'DI') {
            newTree = with_fallback ? diTreeWithFallback : diTreeNormal;
        } else if (type === 'GpioDiControl') {
            newTree = with_fallback ? gpioDiTreeWithFallback : gpioDiTreeNormal;
        }

        // ---------------- SAVE ----------------
        trees.push(newTree);
        data.root.BehaviorTree = trees;

        await saveXML(data);

        return res.json({
            message: `Added ${name} (${type}${(type === 'DI' || type === 'GpioDiControl') && with_fallback ? ' with fallback' : ''})`,
            xml: buildXML(data)
        });

    } catch (err) {
        console.error('Error in /addControl:', err);
        return res.status(500).json({ message: err.message });
    }
}


export const updateControlController = async (req, res) => {
    try {
        const {
            oldName,
            type,
            name,
            driverId,
            gpioId,
            doId,
            diId,
            controlType,
            pushWait,
            waitTime,
            responseMsg,
            with_fallback
        } = req.body;

        const isGpio = type === 'GpioDoControl' || type === 'GpioDiControl';
        const controllerId = isGpio ? gpioId : driverId;

        // ---------------- VALIDATION ----------------
        if (
            !oldName ||
            !type ||
            !name ||
            !controllerId ||
            !responseMsg ||
            !/^[A-Za-z0-9]+(\[(DO|DI)\])?$/.test(name)
        ) {
            return res.status(400).json({ message: 'Missing or invalid required fields' });
        }

        if ((type === 'DO' || type === 'GpioDoControl') && (!doId || !controlType)) {
            return res.status(400).json({ message: 'Missing DO required fields' });
        }

        if ((type === 'DI' || type === 'GpioDiControl') && !diId) {
            return res.status(400).json({ message: 'Missing DI required fields' });
        }

        // ---------------- LOAD XML ----------------
        const data = await loadXML();
        let trees = Array.isArray(data.root.BehaviorTree)
            ? data.root.BehaviorTree
            : (data.root.BehaviorTree ? [data.root.BehaviorTree] : []);

        const index = trees.findIndex(tree => tree.$.ID === oldName);
        if (index === -1) {
            return res.status(404).json({ message: `Control ${oldName} not found` });
        }

        if (name !== oldName && trees.some(tree => tree.$.ID === name)) {
            return res.status(400).json({ message: `Control ${name} already exists` });
        }

        // ---------------- DO TREE ----------------
        const doTree = {
            $: { ID: name },
            Sequence: {
                $: { ID: 'seq_1' },
                MsgLogger: {
                    $: { ID: 'msg_1', msg_log: `${name} subtree starting...` }
                },
                DoControl: {
                    $: {
                        ID: 'ctrl_1',
                        name: name,
                        driver_id: driverId,
                        do_id: doId,
                        control_name: name,
                        type_of_control: controlType,
                        expected_action: '{expected_action}',
                        ...(pushWait !== undefined && { push_wait: pushWait })
                    }
                },
                Sequence: {
                    $: { ID: `seq_2` },
                    MsgLogger: { $: { ID: `msg_2`, msg_log: responseMsg } }
                }
                // ,
                // MsgPopup: {
                //     $: {
                //         ID: 'pop_1',
                //         msg: `${name} action successful`,
                //         type: 'success',
                //         timeout: '3'
                //     }
                // }
            }
        };

        // ---------------- DI SUCCESS SEQUENCE ----------------
        const diSuccessSequence = {
            $: { ID: 'success_seq' },
            MsgLogger: {
                $: { ID: 'msg_1', msg_log: `${name} subtree starting...` }
            },
            DIControl: {
                $: {
                    ID: 'ctrl_1',
                    name: name,
                    driver_id: driverId,
                    di_id: diId,
                    status_name: name,
                    expected_status: '{expected_status}',
                    ...(waitTime && { wait_time: waitTime })
                }
            },
            Sequence: {
                $: { ID: `seq_2` },
                MsgLogger: { $: { ID: `msg_2`, msg_log: responseMsg } }
            }
            // ,
            // MsgPopup: {
            //     $: {
            //         ID: 'pop_1',
            //         msg: `${name} sensing successful`,
            //         type: 'success',
            //         timeout: '3'
            //     }
            // }
        };

        // ---------------- DI TREE (NO FALLBACK) ----------------
        const diTreeNormal = {
            $: { ID: name },
            Sequence: diSuccessSequence
        };

        // ---------------- DI TREE (WITH FALLBACK) ----------------
        const diTreeWithFallback = {
            $: { ID: name },
            Fallback: {
                Sequence: [
                    diSuccessSequence,
                    {
                        $: { ID: 'failure_seq' },
                        MsgPopup: {
                            $: {
                                ID: 'pop_fail',
                                msg: `${name} sensing failed`,
                                type: 'failure',
                                timeout: '0'
                            }
                        },
                        MsgLogger: {
                            $: {
                                ID: 'msg_fail',
                                msg_log: `${name} sensing failed`
                            }
                        },
                        AlwaysFailure: {}
                    }
                ]
            }
        };

        // ---------------- GpioDoControl TREE ----------------
        const gpioDoTree = {
            $: { ID: name },
            Sequence: {
                $: { ID: 'seq_1' },
                MsgLogger: {
                    $: { ID: 'msg_1', msg_log: `${name} subtree starting...` }
                },
                GpioDoControl: {
                    $: {
                        ID: 'ctrl_1',
                        name,
                        gpio_id: gpioId,
                        do_id: doId,
                        control_name: name,
                        type_of_control: controlType,
                        expected_action: '{expected_action}',
                        ...(pushWait !== undefined && { push_wait: pushWait })
                    }
                },
                Sequence: {
                    $: { ID: `seq_2` },
                    MsgLogger: { $: { ID: `msg_2`, msg_log: responseMsg } }
                }
            }
        };

        // ---------------- GpioDiControl SUCCESS SEQUENCE ----------------
        const gpioDiSuccessSequence = {
            $: { ID: 'success_seq' },
            MsgLogger: {
                $: { ID: 'msg_1', msg_log: `${name} subtree starting...` }
            },
            GpioDiControl: {
                $: {
                    ID: 'ctrl_1',
                    name,
                    gpio_id: gpioId,
                    di_id: diId,
                    status_name: name,
                    expected_status: '{expected_status}',
                    ...(waitTime && { wait_time: waitTime })
                }
            },
            Sequence: {
                $: { ID: `seq_2` },
                MsgLogger: { $: { ID: `msg_2`, msg_log: responseMsg } }
            }
        };

        // ---------------- GpioDiControl TREE (NO FALLBACK) ----------------
        const gpioDiTreeNormal = {
            $: { ID: name },
            Sequence: gpioDiSuccessSequence
        };

        // ---------------- GpioDiControl TREE (WITH FALLBACK) ----------------
        const gpioDiTreeWithFallback = {
            $: { ID: name },
            Fallback: {
                Sequence: [
                    gpioDiSuccessSequence,
                    {
                        $: { ID: 'failure_seq' },
                        MsgPopup: {
                            $: {
                                ID: 'pop_fail',
                                msg: `${name} sensing failed`,
                                type: 'failure',
                                timeout: '0'
                            }
                        },
                        MsgLogger: {
                            $: {
                                ID: 'msg_fail',
                                msg_log: `${name} sensing failed`
                            }
                        },
                        AlwaysFailure: {}
                    }
                ]
            }
        };
        // ---------------- FINAL TREE SELECTION ----------------
        // ---------------- FINAL TREE SELECTION ----------------
        let newTree;
        if (type === 'DO') {
            newTree = doTree;
        } else if (type === 'GpioDoControl') {
            newTree = gpioDoTree;
        } else if (type === 'DI') {
            newTree = with_fallback ? diTreeWithFallback : diTreeNormal;
        } else if (type === 'GpioDiControl') {
            newTree = with_fallback ? gpioDiTreeWithFallback : gpioDiTreeNormal;
        }

        // ---------------- SAVE ----------------
        trees[index] = newTree;
        data.root.BehaviorTree = trees;

        await saveXML(data);

        return res.json({
            message: `Updated ${oldName} → ${name} (${type}${(type === 'DI' || type === 'GpioDiControl') && with_fallback ? ' with fallback' : ''})`,
            xml: buildXML(data)
        });

    } catch (err) {
        console.error('Error in /updateControl:', err);
        return res.status(500).json({ message: err.message });
    }
}

export const deleteControlController = async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) {
            return res.status(400).json({ message: 'Missing name' });
        }
        const data = await loadXML();
        let trees = Array.isArray(data.root.BehaviorTree) ? data.root.BehaviorTree : [data.root.BehaviorTree];
        const initialLength = trees.length;
        trees = trees.filter(tree => tree.$.ID !== name);
        if (trees.length === initialLength) {
            return res.status(404).json({ message: `Control ${name} not found` });
        }
        data.root.BehaviorTree = trees.length > 0 ? trees : undefined;
        await saveXML(data);
        return res.json({ message: `Deleted ${name}`, xml: buildXML(data) });
    } catch (err) {
        console.error('Error in /deleteControl:', err);
        return res.status(500).json({ message: err.message });
    }
}


export const deleteAllController = async (req, res) => {
    try {
        const data = await loadXML();
        if (!data.root.BehaviorTree) {
            return res.status(400).json({ message: 'No sequences to delete' });
        }
        data.root.BehaviorTree = undefined;
        await saveXML(data);
        return res.json({ message: 'Deleted all sequences', xml: buildXML(data) });
    } catch (err) {
        console.error('Error in /deleteAll:', err);
        return res.status(500).json({ message: err.message });
    }
}

export const reorderSequenceContoller = async (req, res) => {
    try {
        const { sequenceNames } = req.body;
        const sortOrder = req.query.sortOrder;
        const data = await loadXML();
        let trees = Array.isArray(data.root.BehaviorTree) ? data.root.BehaviorTree : [data.root.BehaviorTree];
        if (sortOrder === 'diFirst' || sortOrder === 'doFirst') {
            const isDiTree = (t) => !!(t.Sequence?.DIControl || t.Sequence?.GpioDiControl || t.Fallback);
            trees = trees.sort((a, b) => {
                const aIsDI = isDiTree(a);
                const bIsDI = isDiTree(b);
                if (sortOrder === 'diFirst') {
                    return aIsDI && !bIsDI ? -1 : !aIsDI && bIsDI ? 1 : 0;
                } else {
                    return !aIsDI && bIsDI ? -1 : aIsDI && !bIsDI ? 1 : 0;
                }
            });
        } else if (Array.isArray(sequenceNames) && sequenceNames.length > 0) {
            const sequenceMap = new Map();
            trees.forEach(tree => {
                if (tree.$?.ID) sequenceMap.set(tree.$.ID, tree);
            });
            const invalidNames = sequenceNames.filter(name => !sequenceMap.has(name));
            if (invalidNames.length > 0) {
                return res.status(404).json({ message: `Controls not found: ${invalidNames.join(', ')}` });
            }
            trees = sequenceNames.map(name => sequenceMap.get(name));
        } else {
            return res.status(400).json({ message: 'Invalid or missing sortOrder or sequenceNames' });
        }
        data.root.BehaviorTree = trees;
        await saveXML(data);
        return res.json({ message: 'Sequences reordered successfully', xml: buildXML(data) });
    } catch (err) {
        console.error('Error in /reorderSequences:', err);
        return res.status(500).json({ message: err.message });
    }
}