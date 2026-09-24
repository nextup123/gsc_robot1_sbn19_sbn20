
import fs from "fs";
import yaml from "js-yaml";
import path from "path";
import { pathPlanningFilePath, TREE_LAYOUT_DIR } from "../config/path.js";


const PATHS_YAML_FILE = pathPlanningFilePath.PATHS_YAML_FILE;

const layoutDir = TREE_LAYOUT_DIR;

// Ensure tree_layout directory exists
export const checkFIleExistMiddleware = (req,res,next) => {
  if (!fs.existsSync(layoutDir)) {
    fs.mkdirSync(layoutDir);
  }
  next();
};


export const loadTreeController = (req, res) => {
  try {
    // Read YAML file
    const yamlData = fs.readFileSync(PATHS_YAML_FILE, 'utf8');
    const parsedData = yaml.load(yamlData);

    // Build graph to compute node depths
    const graph = new Map();
    parsedData.paths.forEach(path => {
      if (!graph.has(path.start_point)) graph.set(path.start_point, []);
      graph.get(path.start_point).push(path.end_point);
    });

    // Compute depths using BFS, starting from first path's start_point
    const root = parsedData.paths[0]?.start_point;
    if (!root) throw new Error('No paths found in YAML');
    const depths = new Map();
    const queue = [root];
    const visited = new Set([root]);
    depths.set(root, 0);

    while (queue.length > 0) {
      const node = queue.shift();
      const depth = depths.get(node);
      const neighbors = graph.get(node) || [];
      neighbors.forEach(neighbor => {
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          depths.set(neighbor, depth + 1);
          queue.push(neighbor);
        }
      });
    }

    // Calculate max depth for dynamic spacing
    const maxDepth = Math.max(...depths.values());
    const xSpacing = maxDepth > 0 ? Math.min(80, 700 / maxDepth) : 80;

    // Transform to required JSON format with layoutCoordinates
    const jsonData = parsedData.paths.map(path => ({
      name: path.name,
      start_point: path.start_point,
      end_point: path.end_point,
      type: path.plan_space.toLowerCase(),
      waypoints: path.data.length,
      metadata: {
        coordinates: path.data[path.data.length - 1].positions.slice(0, 2)
      },
      layoutCoordinates: {
        start: [depths.get(path.start_point) * xSpacing + 50, depths.get(path.start_point) % 2 === 0 ? 250 : 350],
        end: [depths.get(path.end_point) * xSpacing + 50, depths.get(path.end_point) % 2 === 0 ? 250 : 350]
      }
    }));

    res.json(jsonData);
  } catch (error) {
    console.error('Error processing YAML:', error.message);
    res.status(500).json({ error: 'Failed to process YAML file: ' + error.message });
  }
}

export const saveLayoutController = (req, res) => {
  try {
    const layoutData = req.body;
    const layoutName = req.body.name || `layout-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    const filename = `${layoutName}.json`;
    const filePath = path.join(layoutDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(layoutData, null, 2));
    console.log(`Layout saved to ${filePath}`);
    res.json({ success: true, filename });
  } catch (error) {
    console.error('Error saving layout:', error.message);
    res.status(500).json({ error: 'Failed to save layout: ' + error.message });
  }
}

export const listLayoutsController = (req, res) => {
  try {
    const files = fs.readdirSync(layoutDir).filter(file => file.endsWith('.json'));
    console.log('Available layouts:', files);
    res.json(files);
  } catch (error) {
    console.error('Error listing layouts:', error.message);
    res.status(500).json({ error: 'Failed to list layouts: ' + error.message });
  }
}