
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { readJSONFile, saveToUndo, writeJSONFile } from "../service/sequenceCreatorService.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SEQUENCE_FILE = path.join(__dirname, "../config/path_sequence.json");
const UNDO_FILE = path.join(__dirname, "../config/path_sequence_undo.json");
const DEFAULT_VELOCITY = 0.2;
const MIN_VELOCITY = 0.01;
const MAX_VELOCITY = 0.3;



export const getAllSequenceController =  async (req, res) => {
    try {
        const data = await readJSONFile(SEQUENCE_FILE);
        res.json({
            success: true,
            sequences: data.sequences || [],
            total: (data.sequences || []).length
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: `Failed to read sequences: ${error.message}` 
        });
    }
}

export const getUndoHistoryController = async (req, res) => {
    try {
        const undoData = await readJSONFile(UNDO_FILE);
        res.json({
            success: true,
            undoHistory: undoData.history || [],
            canUndo: (undoData.history || []).length > 0
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: `Failed to read undo history: ${error.message}` 
        });
    }
}

export const saveNewSequenceController = async (req, res) => {
    try {
        const { sequence, sequenceName, steps, start, current } = req.body;
        
        // Check if we have the old format (with "sequence" root)
        if (sequence) {
            // Old format from frontend
            const { id, name, createdAt, start: seqStart, current: seqCurrent, steps: seqSteps } = sequence;
            
            // Validate steps
            if (!seqSteps || !Array.isArray(seqSteps)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid sequence format. Must have steps array'
                });
            }
            
            // Process steps with velocities
            const processedSteps = seqSteps.map((step, index) => {
                // Set default velocity if not provided
                let velocity = step.velocity || DEFAULT_VELOCITY;
                
                // Clamp velocity to allowed range
                velocity = Math.max(MIN_VELOCITY, Math.min(MAX_VELOCITY, velocity));
                
                return {
                    order: step.order || index + 1,
                    path: step.path,
                    type: step.type,
                    from: step.from,
                    to: step.to,
                    velocity: parseFloat(velocity.toFixed(2))
                };
            });
            
            // Create sequence object
            const sequenceObj = {
                id: id || `seq_${Date.now()}`,
                name: name || sequenceName || `sequence_${new Date().toISOString().slice(0, 10)}`,
                createdAt: createdAt || new Date().toISOString(),
                start: seqStart || start || 'unknown',
                current: seqCurrent || current || 'unknown',
                totalSteps: processedSteps.length,
                steps: processedSteps
            };
            
            // Save to undo
            await saveToUndo();
            
            // Save this single sequence (overwrites existing file)
            await writeJSONFile(SEQUENCE_FILE, { sequences: [sequenceObj] });
            
            return res.json({
                success: true,
                message: 'Sequence saved successfully',
                sequence: sequenceObj
            });
            
        } else if (steps && Array.isArray(steps)) {
            // New format with direct steps
            // Process steps with velocities
            const processedSteps = steps.map((step, index) => {
                let velocity = step.velocity || DEFAULT_VELOCITY;
                velocity = Math.max(MIN_VELOCITY, Math.min(MAX_VELOCITY, velocity));
                
                return {
                    order: index + 1,
                    path: step.path,
                    type: step.type,
                    from: step.from,
                    to: step.to,
                    velocity: parseFloat(velocity.toFixed(2))
                };
            });
            
            // Create sequence object
            const sequenceObj = {
                id: `seq_${Date.now()}`,
                name: sequenceName || `sequence_${new Date().toISOString().slice(0, 10)}`,
                createdAt: new Date().toISOString(),
                start: start || 'unknown',
                current: current || 'unknown',
                totalSteps: processedSteps.length,
                steps: processedSteps
            };
            
            // Save to undo
            await saveToUndo();
            
            // Save this single sequence (overwrites existing file)
            await writeJSONFile(SEQUENCE_FILE, { sequences: [sequenceObj] });
            
            return res.json({
                success: true,
                message: 'Sequence saved successfully',
                sequence: sequenceObj
            });
            
        } else {
            return res.status(400).json({
                success: false,
                error: 'Invalid request format. Provide either "sequence" object or "steps" array'
            });
        }
        
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: `Failed to save sequence: ${error.message}` 
        });
    }
}


export const appendController = async (req, res) => {
    try {
        const { sequence, sequenceName, steps, start, current } = req.body;
        
        // Read existing sequences
        const existingData = await readJSONFile(SEQUENCE_FILE);
        if (!existingData.sequences) existingData.sequences = [];
        
        let newSequence;
        
        if (sequence) {
            // Old format
            const { id, name, createdAt, start: seqStart, current: seqCurrent, steps: seqSteps } = sequence;
            
            if (!seqSteps || !Array.isArray(seqSteps)) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid sequence format'
                });
            }
            
            const processedSteps = seqSteps.map((step, index) => {
                let velocity = step.velocity || DEFAULT_VELOCITY;
                velocity = Math.max(MIN_VELOCITY, Math.min(MAX_VELOCITY, velocity));
                
                return {
                    order: step.order || index + 1,
                    path: step.path,
                    type: step.type,
                    from: step.from,
                    to: step.to,
                    velocity: parseFloat(velocity.toFixed(2))
                };
            });
            
            newSequence = {
                id: id || `seq_${Date.now()}`,
                name: name || sequenceName || `sequence_${new Date().toISOString().slice(0, 10)}`,
                createdAt: createdAt || new Date().toISOString(),
                start: seqStart || start || 'unknown',
                current: seqCurrent || current || 'unknown',
                totalSteps: processedSteps.length,
                steps: processedSteps
            };
            
        } else if (steps && Array.isArray(steps)) {
            const processedSteps = steps.map((step, index) => {
                let velocity = step.velocity || DEFAULT_VELOCITY;
                velocity = Math.max(MIN_VELOCITY, Math.min(MAX_VELOCITY, velocity));
                
                return {
                    order: index + 1,
                    path: step.path,
                    type: step.type,
                    from: step.from,
                    to: step.to,
                    velocity: parseFloat(velocity.toFixed(2))
                };
            });
            
            newSequence = {
                id: `seq_${Date.now()}`,
                name: sequenceName || `sequence_${new Date().toISOString().slice(0, 10)}`,
                createdAt: new Date().toISOString(),
                start: start || 'unknown',
                current: current || 'unknown',
                totalSteps: processedSteps.length,
                steps: processedSteps
            };
        } else {
            return res.status(400).json({
                success: false,
                error: 'Invalid request format'
            });
        }
        
        // Save to undo
        await saveToUndo();
        
        // Append new sequence
        existingData.sequences.push(newSequence);
        
        // Save all sequences
        await writeJSONFile(SEQUENCE_FILE, existingData);
        
        res.json({
            success: true,
            message: 'Sequence appended successfully',
            sequence: newSequence,
            totalSequences: existingData.sequences.length
        });
        
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: `Failed to append sequence: ${error.message}` 
        });
    }
}


export const getLatestSequenceController =  async (req, res) => {
    try {
        const data = await readJSONFile(SEQUENCE_FILE);
        
        if (!data.sequences || data.sequences.length === 0) {
            return res.json({
                success: true,
                sequence: null,
                message: 'No sequences found'
            });
        }
        
        // Sort by creation date (newest first) and get the first one
        const sorted = [...data.sequences].sort((a, b) => 
            new Date(b.createdAt) - new Date(a.createdAt)
        );
        
        res.json({
            success: true,
            sequence: sorted[0]
        });
        
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: `Failed to get latest sequence: ${error.message}` 
        });
    }
}

export const updateSequenceByIdController = async (req, res) => {
    try {
        const { id } = req.params;
        const { name, steps, velocityUpdates } = req.body;
        
        const data = await readJSONFile(SEQUENCE_FILE);
        const sequenceIndex = data.sequences.findIndex(seq => seq.id === id);
        
        if (sequenceIndex === -1) {
            return res.status(404).json({
                success: false,
                error: 'Sequence not found'
            });
        }

        // Save to undo
        await saveToUndo();

        // Update sequence
        const sequence = data.sequences[sequenceIndex];
        
        if (name) sequence.name = name;
        
        if (steps && Array.isArray(steps)) {
            sequence.steps = steps.map((step, index) => ({
                order: index + 1,
                path: step.path,
                type: step.type,
                from: step.from,
                to: step.to,
                velocity: Math.max(MIN_VELOCITY, Math.min(MAX_VELOCITY, 
                    step.velocity || DEFAULT_VELOCITY))
            }));
            sequence.totalSteps = steps.length;
        }

        // Update specific velocities
        if (velocityUpdates && Array.isArray(velocityUpdates)) {
            velocityUpdates.forEach(update => {
                const step = sequence.steps.find(s => s.order === update.order);
                if (step) {
                    step.velocity = Math.max(MIN_VELOCITY, Math.min(MAX_VELOCITY, 
                        update.velocity || DEFAULT_VELOCITY));
                }
            });
        }

        sequence.updatedAt = new Date().toISOString();
        data.sequences[sequenceIndex] = sequence;

        await writeJSONFile(SEQUENCE_FILE, data);

        res.json({
            success: true,
            message: 'Sequence updated successfully',
            sequence
        });

    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: `Failed to update sequence: ${error.message}` 
        });
    }
}

export const deleteSequenceByIdController = async (req, res) => {
    try {
        const { id } = req.params;
        const data = await readJSONFile(SEQUENCE_FILE);
        
        const sequenceIndex = data.sequences.findIndex(seq => seq.id === id);
        if (sequenceIndex === -1) {
            return res.status(404).json({
                success: false,
                error: 'Sequence not found'
            });
        }

        // Save to undo
        await saveToUndo();

        // Remove sequence
        const deletedSequence = data.sequences.splice(sequenceIndex, 1)[0];
        
        await writeJSONFile(SEQUENCE_FILE, data);

        res.json({
            success: true,
            message: 'Sequence deleted successfully',
            deletedSequence,
            remainingSequences: data.sequences.length
        });

    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: `Failed to delete sequence: ${error.message}` 
        });
    }
}

export const undoLastOperationController = async (req, res) => {
    try {
        const undoData = await readJSONFile(UNDO_FILE);
        
        if (!undoData.history || undoData.history.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'No operations to undo'
            });
        }

        // Get last state from undo history
        const lastState = undoData.history.pop();
        
        // Restore previous state
        await writeJSONFile(SEQUENCE_FILE, lastState.previousState);
        
        // Update undo file
        await writeJSONFile(UNDO_FILE, undoData);

        res.json({
            success: true,
            message: 'Undo successful',
            undoneOperation: lastState,
            remainingUndos: undoData.history.length
        });

    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: `Failed to undo: ${error.message}` 
        });
    }
}

export const clearUndoController = async (req, res) => {
    try {
        await writeJSONFile(UNDO_FILE, { history: [] });
        res.json({
            success: true,
            message: 'Undo history cleared'
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: `Failed to clear undo history: ${error.message}` 
        });
    }
}

export const clearAllController = async (req, res) => {
    try {
        // Save to undo
        await saveToUndo();
        
        // Clear all sequences
        await writeJSONFile(SEQUENCE_FILE, { sequences: [] });
        
        res.json({
            success: true,
            message: 'All sequences cleared'
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: `Failed to clear sequences: ${error.message}` 
        });
    }
}