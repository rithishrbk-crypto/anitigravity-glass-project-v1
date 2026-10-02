import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = path.join(__dirname, 'src', 'data');
const rawDir = path.join(dataDir, 'raw');
const processedDir = path.join(dataDir, 'processed');

// Read raw files
const project1Tracks = JSON.parse(fs.readFileSync(path.join(rawDir, 'project1_tracks.json'), 'utf8'));
const project2Tracks = JSON.parse(fs.readFileSync(path.join(rawDir, 'project2_tracks.json'), 'utf8'));

// Initialize processed feature collection
const processedGeoJSON = {
  type: "FeatureCollection",
  name: "Campus_Navigation_Network",
  features: []
};

// 1. Process "entrance to canteen" (Project 1) -> College Entrance to Hospital junction
const entranceToHospitalRaw = project1Tracks.features.find(f => f.properties.Name === "entrance to canteen");
// Trim after reaching hospital latitude area (~12.3338) and remove GPS wandering
// Let's filter coordinates manually. We know wandering starts when it goes south past 12.3338.
// But we want it to connect to the hospital junction.
// Hospital coordinates: 12.33362238, 79.78164300
// Wait, from the analysis, the coordinate near index 195: [79.781708333, 12.333856667] is near the hospital area.
// After that it wanders south. Let's find the first index where longitude is > 79.7816 and latitude is around 12.3338.
const coords1 = entranceToHospitalRaw.geometry.coordinates;
let cutoffIndex = coords1.length;
for (let i = 0; i < coords1.length; i++) {
  // It goes eastward, and then southward.
  // The moment it goes south of 12.33385, we cut it off.
  if (coords1[i][1] < 12.33385 && coords1[i][0] > 79.7815) {
    cutoffIndex = i;
    break;
  }
}
const trimmedCoords1 = coords1.slice(0, cutoffIndex + 1);

processedGeoJSON.features.push({
  type: "Feature",
  properties: {
    Name: "College Entrance to Hospital Junction",
    Source: "Project 1 / entrance to canteen"
  },
  geometry: {
    type: "LineString",
    coordinates: trimmedCoords1
  }
});


// 2. Process "hospital to canteen" (Project 1) -> Hospital to Aavin Canteen
const hospitalToCanteenRaw = project1Tracks.features.find(f => f.properties.Name === "hospital to canteen");
const coords2 = hospitalToCanteenRaw.geometry.coordinates;
// Let's clean up initial jitter. The first few points might be stationary.
// Just use the whole track for now, as it's not wandering drastically.
processedGeoJSON.features.push({
  type: "Feature",
  properties: {
    Name: "Hospital Junction to Aavin Canteen",
    Source: "Project 1 / hospital to canteen"
  },
  geometry: {
    type: "LineString",
    coordinates: coords2
  }
});


// 3. Process "Track 1" (Project 2) -> College Entrance to Aavin Canteen
const collegeToCanteenRaw = project2Tracks.features.find(f => f.properties.Name === "Track 1");
const coords3 = collegeToCanteenRaw.geometry.coordinates;
// Remove duplicate end coordinates (where it's stationary)
const trimmedCoords3 = [];
let lastCoord = null;
for (let i = 0; i < coords3.length; i++) {
  if (lastCoord) {
    // If distance is very small (identical or almost identical coords), skip
    const dx = coords3[i][0] - lastCoord[0];
    const dy = coords3[i][1] - lastCoord[1];
    const distSq = dx*dx + dy*dy;
    if (distSq > 0.0000000001) {
      trimmedCoords3.push(coords3[i]);
      lastCoord = coords3[i];
    }
  } else {
    trimmedCoords3.push(coords3[i]);
    lastCoord = coords3[i];
  }
}

processedGeoJSON.features.push({
  type: "Feature",
  properties: {
    Name: "College Entrance to Aavin Canteen",
    Source: "Project 2 / Track 1"
  },
  geometry: {
    type: "LineString",
    coordinates: trimmedCoords3
  }
});

// Write to processed directory
fs.writeFileSync(
  path.join(processedDir, 'campus_navigation.json'),
  JSON.stringify(processedGeoJSON, null, 2)
);

console.log("Processing complete. Wrote campus_navigation.json");
