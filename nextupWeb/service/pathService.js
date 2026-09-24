import fs from "fs";
import yaml from "js-yaml";
import { pathPlanningFilePath, pointPlanningFilePath } from "../config/path.js";
const PATHS_YAML_FILE = pathPlanningFilePath.PATHS_YAML_FILE;
const POINTS_YAML_FILE = pointPlanningFilePath.POINTS_YAML_FILE;

// Load and parse YAML files
export function loadYAMLFile(filePath) {
  try {
    const yamlData = fs.readFileSync(filePath, "utf8");
    return yaml.load(yamlData);
  } catch (error) {
    console.error(`Error loading YAML file ${filePath}:`, error.message);
    return null;
  }
}

// Create Path Object
export function createPathObject(pathData) {
  if (!pathData.data || pathData.data.length === 0) {
    return {
      ...pathData,
      data: {
        expected_start_pose: null,
        expected_end_pose: null,
      },
    };
  }

  return {
    name: pathData.name,
    plan_space: pathData.plan_space,
    start_point: pathData.start_point,
    end_point: pathData.end_point,
    data: {
      expected_start_pose: pathData.data[0].positions,
      expected_end_pose: pathData.data[pathData.data.length - 1].positions,
    },
  };
}

// Create Point Object
export function createPointObject(pointData) {
  return {
    name: pointData.name,
    date_time: pointData.date_time,
    sequence: pointData.sequence,
    nature: pointData.nature,
    joints_values: pointData.joints_values,
    coordinate: pointData.coordinate,
  };
}

// Compare arrays with 4 decimal precision
export function comparePoses(pose1, pose2, tolerance = 0.0001) {
  if (!pose1 || !pose2) return false;
  if (pose1.length !== pose2.length) return false;

  for (let i = 0; i < pose1.length; i++) {
    if (Math.abs(pose1[i] - pose2[i]) > tolerance) {
      return false;
    }
  }
  return true;
}

// Convert joint values object to array in correct order
export function jointsValuesToArray(jointsValues) {
  return [
    jointsValues.joint1,
    jointsValues.joint2,
    jointsValues.joint3,
    jointsValues.joint4,
    jointsValues.joint5,
    jointsValues.joint6,
  ];
}

// ========== DATA LOADING FUNCTIONS ==========

export function loadPathsData() {
  const pathsData = loadYAMLFile(PATHS_YAML_FILE);
  return pathsData ? pathsData.paths.map(createPathObject) : [];
}

export function loadPointsData() {
  const pointsData = loadYAMLFile(POINTS_YAML_FILE);
  return pointsData ? pointsData.points.map(createPointObject) : [];
}

export function loadTestingPointsData() {
  const testingPointsData = loadYAMLFile(POINTS_YAML_FILE);
  return testingPointsData
    ? testingPointsData.points.map(createPointObject)
    : [];
}

// ========== ANALYSIS FUNCTIONS ==========

export function analyzePathContinuity(paths, points) {
  // Create points lookup map
  const pointsMap = new Map();
  points.forEach((point) => {
    pointsMap.set(point.name, point);
  });

  // Check continuity for each path
  const continuityResults = paths.map((path) => {
    const startPoint = pointsMap.get(path.start_point);
    const endPoint = pointsMap.get(path.end_point);

    let startMatch = false;
    let endMatch = false;
    let startMismatchDetails = null;
    let endMismatchDetails = null;

    // Check start point continuity
    if (startPoint && path.data.expected_start_pose) {
      const actualStartPose = jointsValuesToArray(startPoint.joints_values);
      startMatch = comparePoses(path.data.expected_start_pose, actualStartPose);

      if (!startMatch) {
        startMismatchDetails = {
          expected: path.data.expected_start_pose,
          actual: actualStartPose,
        };
      }
    }

    // Check end point continuity
    if (endPoint && path.data.expected_end_pose) {
      const actualEndPose = jointsValuesToArray(endPoint.joints_values);
      endMatch = comparePoses(path.data.expected_end_pose, actualEndPose);

      if (!endMatch) {
        endMismatchDetails = {
          expected: path.data.expected_end_pose,
          actual: actualEndPose,
        };
      }
    }

    return {
      path_name: path.name,
      start_point: path.start_point,
      end_point: path.end_point,
      plan_space: path.plan_space,
      continuity: {
        start_point_match: startMatch,
        end_point_match: endMatch,
        fully_continuous: startMatch && endMatch,
      },
      mismatches: {
        start: startMismatchDetails,
        end: endMismatchDetails,
      },
    };
  });

  return continuityResults;
}

export function findDuplicatePoints(points) {
  const duplicates = new Map();
  const processed = new Set();

  points.forEach((point1, index1) => {
    if (processed.has(point1.name)) return;

    const point1Joints = jointsValuesToArray(point1.joints_values);
    const duplicateGroup = [point1];

    // Compare with all other points
    points.forEach((point2, index2) => {
      if (index1 !== index2 && !processed.has(point2.name)) {
        const point2Joints = jointsValuesToArray(point2.joints_values);
        if (comparePoses(point1Joints, point2Joints)) {
          duplicateGroup.push(point2);
          processed.add(point2.name);
        }
      }
    });

    if (duplicateGroup.length > 1) {
      processed.add(point1.name);
      duplicates.set(point1.name, duplicateGroup);
    }
  });

  return duplicates;
}

// ========== LOGGING FUNCTIONS ==========

export function logPathContinuityResults(continuityResults) {
  console.log("\n=== PATH CONTINUITY CHECK RESULTS ===");
  continuityResults.forEach((result) => {
    const status = result.continuity.fully_continuous
      ? "✓ CONTINUOUS"
      : "✗ BROKEN";
    console.log(`\n${result.path_name}: ${status}`);
    console.log(
      `  Start: ${result.start_point} - ${result.continuity.start_point_match ? "✓" : "✗"}`,
    );
    console.log(
      `  End: ${result.end_point} - ${result.continuity.end_point_match ? "✓" : "✗"}`,
    );

    if (!result.continuity.start_point_match && result.mismatches.start) {
      console.log(`  Start Mismatch:`);
      console.log(
        `    Expected: [${result.mismatches.start.expected.map((v) => v.toFixed(6)).join(", ")}]`,
      );
      console.log(
        `    Actual:   [${result.mismatches.start.actual.map((v) => v.toFixed(6)).join(", ")}]`,
      );
    }

    if (!result.continuity.end_point_match && result.mismatches.end) {
      console.log(`  End Mismatch:`);
      console.log(
        `    Expected: [${result.mismatches.end.expected.map((v) => v.toFixed(6)).join(", ")}]`,
      );
      console.log(
        `    Actual:   [${result.mismatches.end.actual.map((v) => v.toFixed(6)).join(", ")}]`,
      );
    }
  });

  // Summary
  const continuousPaths = continuityResults.filter(
    (r) => r.continuity.fully_continuous,
  ).length;
  const totalPaths = continuityResults.length;
  console.log(`\n=== SUMMARY ===`);
  console.log(`Continuous paths: ${continuousPaths}/${totalPaths}`);
  console.log(`Broken paths: ${totalPaths - continuousPaths}/${totalPaths}`);
}

export function logDuplicatePoints(duplicates) {
  console.log("\n=== DUPLICATE POINTS ANALYSIS ===");

  if (duplicates.size === 0) {
    console.log("No duplicate points found.");
    return;
  }

  console.log(`Found ${duplicates.size} groups of duplicate points:\n`);

  let groupCount = 1;
  duplicates.forEach((pointsGroup, key) => {
    console.log(`Group ${groupCount}:`);
    pointsGroup.forEach((point) => {
      const jointsArray = jointsValuesToArray(point.joints_values);
      console.log(`  - ${point.name} (${point.nature})`);
      console.log(
        `    Joints: [${jointsArray.map((v) => v.toFixed(6)).join(", ")}]`,
      );
      console.log(
        `    Coordinate: x:${point.coordinate.x}, y:${point.coordinate.y}, z:${point.coordinate.z}`,
      );
    });
    groupCount++;
  });
}
