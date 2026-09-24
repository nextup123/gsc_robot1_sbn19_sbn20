import {
  analyzePathContinuity,
  findDuplicatePoints,
  loadPathsData,
  loadPointsData,
  loadTestingPointsData,
  logDuplicatePoints,
  logPathContinuityResults,
} from "../service/pathService.js";

export const checkPathContinuityController = (req, res) => {
  try {
    const paths = loadPathsData();
    const points = loadPointsData();

    if (paths.length === 0 || points.length === 0) {
      return res.status(500).json({ error: "Failed to load YAML files" });
    }

    const continuityResults = analyzePathContinuity(paths, points);
    logPathContinuityResults(continuityResults);

    const continuousPaths = continuityResults.filter(
      (r) => r.continuity.fully_continuous,
    ).length;
    const totalPaths = continuityResults.length;

    res.json({
      summary: {
        total_paths: totalPaths,
        continuous_paths: continuousPaths,
        broken_paths: totalPaths - continuousPaths,
      },
      results: continuityResults,
    });
  } catch (error) {
    console.error("Error in path continuity check:", error.message);
    res
      .status(500)
      .json({ error: "Failed to check path continuity: " + error.message });
  }
};

export const checkDuplicatePointsController = (req, res) => {
  try {
    const points = loadTestingPointsData();

    if (points.length === 0) {
      return res.status(500).json({ error: "Failed to load points YAML file" });
    }

    const duplicates = findDuplicatePoints(points);
    logDuplicatePoints(duplicates);

    // Convert Map to array for JSON response
    const duplicatesArray = Array.from(duplicates.values());

    res.json({
      summary: {
        total_points: points.length,
        duplicate_groups: duplicates.size,
        total_duplicate_points: duplicatesArray.reduce(
          (sum, group) => sum + group.length,
          0,
        ),
      },
      duplicate_groups: duplicatesArray,
    });
  } catch (error) {
    console.error("Error in duplicate points check:", error.message);
    res
      .status(500)
      .json({ error: "Failed to check duplicate points: " + error.message });
  }
};

export const getPathController = (req, res) => {
  try {
    const paths = loadPathsData();
    const points = loadPointsData();

    if (paths.length === 0 || points.length === 0) {
      return res.status(500).json({ error: "Failed to load YAML files" });
    }

    res.json({
      paths: paths,
      points: points,
    });
  } catch (error) {
    console.error("Error loading paths:", error.message);
    res.status(500).json({ error: "Failed to load paths: " + error.message });
  }
};

export const testingPointsController = (req, res) => {
  try {
    const points = loadTestingPointsData();

    if (points.length === 0) {
      return res
        .status(500)
        .json({ error: "Failed to load testing points YAML file" });
    }

    res.json({
      points: points,
    });
  } catch (error) {
    console.error("Error loading testing points:", error.message);
    res
      .status(500)
      .json({ error: "Failed to load testing points: " + error.message });
  }
};
