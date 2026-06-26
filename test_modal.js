import fs from 'fs';
let code = fs.readFileSync('src/modals/InsightsModal.jsx', 'utf-8');
const before = "const group = (peerCount > 0 && groupCentroids.length)";
const after = "const group = (groupCentroids.length)";
if (code.includes(before)) {
  fs.writeFileSync('src/modals/InsightsModal.jsx', code.replace(before, after));
  console.log("Patched");
} else {
  console.log("Not found");
}
