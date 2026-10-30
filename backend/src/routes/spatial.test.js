/**
 * spatial.test.js — Dev sanity check for spatial aggregation logic
 *
 * Exercises the chainage-binning SQL logic manually against mock data.
 * Run with:  node src/routes/spatial.test.js
 *
 * Does NOT require a live database — uses in-process mock rows only.
 */

'use strict';

// ─── Colour helpers (ANSI) ────────────────────────────────────────────────────
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET  = '\x1b[0m';

let passed = 0;
let failed = 0;

function assertEqual(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) {
    console.log(`  ${GREEN}✓${RESET} ${label}`);
    passed++;
  } else {
    console.log(`  ${RED}✗${RESET} ${label}`);
    console.log(`      expected: ${JSON.stringify(expected)}`);
    console.log(`      actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

// ─── Re-implement core logic (mirrors spatial.js) ─────────────────────────────

/**
 * Simulate the SQL FLOOR-based chainage binning in JavaScript.
 *
 * @param {Array<{coord_z: number, confidence: number}>} rows  Mock detection rows
 * @param {number} intervalM  Bin width in metres
 * @param {number} minConf    Minimum confidence filter
 * @returns {Array}  Array of bin objects (same shape as DB result rows)
 */
function simulateBinning(rows, intervalM, minConf) {
  // Apply WHERE filter
  const filtered = rows.filter(
    (r) => r.coord_z !== null && r.coord_z !== undefined && r.confidence >= minConf,
  );

  // Group by bin key
  const bins = new Map();

  for (const row of filtered) {
    const binKey       = Math.floor(row.coord_z / intervalM);
    const chainageStart = binKey * intervalM;
    const chainageEnd   = (binKey + 1) * intervalM;

    if (!bins.has(binKey)) {
      bins.set(binKey, {
        chainage_start:  chainageStart,
        chainage_end:    chainageEnd,
        total_count:     0,
        critical_count:  0,
        major_count:     0,
        minor_count:     0,
        confidences:     [],
      });
    }

    const bin = bins.get(binKey);
    bin.total_count++;
    bin.confidences.push(row.confidence);

    if (row.confidence >= 0.75) {
      bin.critical_count++;
    } else if (row.confidence >= 0.50) {
      bin.major_count++;
    } else if (row.confidence >= 0.35) {
      bin.minor_count++;
    }
  }

  // Sort by chainage_start and compute aggregates
  return [...bins.values()]
    .sort((a, b) => a.chainage_start - b.chainage_start)
    .map((bin) => {
      const avg = bin.confidences.reduce((s, c) => s + c, 0) / bin.confidences.length;
      const max = Math.max(...bin.confidences);
      return {
        chainage_start: bin.chainage_start,
        chainage_end:   bin.chainage_end,
        total_count:    bin.total_count,
        critical_count: bin.critical_count,
        major_count:    bin.major_count,
        minor_count:    bin.minor_count,
        avg_confidence: Math.round(avg * 1000) / 1000,
        max_confidence: max,
      };
    });
}

/** Mirror of classifyRisk from spatial.js */
function classifyRisk(criticalCount, majorCount, avgConfidence) {
  if (criticalCount > 0 || avgConfidence >= 0.75) return 'HIGH';
  if (majorCount   > 0 || avgConfidence >= 0.50)  return 'MEDIUM';
  return 'LOW';
}

// ─── Mock data ────────────────────────────────────────────────────────────────
//
// Detections spread along a 250 m tunnel at known positions:
//
//  coord_z  confidence  expected bin (10 m)
//  -------  ----------  -------------------
//    2.0      0.80       [0, 10)   → CRITICAL
//    5.5      0.60       [0, 10)   → MAJOR
//    9.9      0.40       [0, 10)   → MINOR
//   12.0      0.90       [10, 20)  → CRITICAL
//   18.5      0.30       [10, 20)  → below minor
//   55.0      0.78       [50, 60)  → CRITICAL
//  120.0      0.45       [120,130) → MINOR
//  249.9      0.55       [240,250) → MAJOR
//  null       0.80       filtered (coord_z IS NULL)
//    1.0      0.10       filtered (below min_conf=0.35 baseline)

const MOCK_ROWS = [
  { coord_z:   2.0, confidence: 0.80 },
  { coord_z:   5.5, confidence: 0.60 },
  { coord_z:   9.9, confidence: 0.40 },
  { coord_z:  12.0, confidence: 0.90 },
  { coord_z:  18.5, confidence: 0.30 },  // low confidence — below 0.35 minor threshold
  { coord_z:  55.0, confidence: 0.78 },
  { coord_z: 120.0, confidence: 0.45 },
  { coord_z: 249.9, confidence: 0.55 },
  { coord_z:  null, confidence: 0.80 },  // should be excluded (coord_z IS NULL)
  { coord_z:   1.0, confidence: 0.10 },  // should be excluded (below min_conf)
];

// ─── Test suite ───────────────────────────────────────────────────────────────

console.log(`\n${YELLOW}HRT Spatial Analytics — sanity test${RESET}`);
console.log('━'.repeat(55));

// ── Test 1: Bin counts with interval=10, min_conf=0.0 ─────────────────────────
console.log('\n[1] Binning with interval=10 m, min_conf=0.0');
{
  const bins = simulateBinning(MOCK_ROWS, 10, 0.0);

  // coord_z=null filtered → 9 remaining rows; coord_z=1.0 conf=0.10 included
  // Bins expected:
  //   [0,10):   coord_z=2.0(0.80), 5.5(0.60), 9.9(0.40), 1.0(0.10) → 4 total
  //   [10,20):  coord_z=12.0(0.90), 18.5(0.30)                      → 2 total
  //   [50,60):  coord_z=55.0(0.78)                                   → 1 total
  //   [120,130):coord_z=120.0(0.45)                                  → 1 total
  //   [240,250):coord_z=249.9(0.55)                                  → 1 total

  assertEqual('Correct number of bins', bins.length, 5);

  const bin0 = bins[0]; // [0, 10)
  assertEqual('Bin[0] chainage_start', bin0.chainage_start, 0);
  assertEqual('Bin[0] chainage_end',   bin0.chainage_end,   10);
  assertEqual('Bin[0] total_count',    bin0.total_count,    4);
  assertEqual('Bin[0] critical_count', bin0.critical_count, 1); // 0.80 >= 0.75
  assertEqual('Bin[0] major_count',    bin0.major_count,    1); // 0.60
  assertEqual('Bin[0] minor_count',    bin0.minor_count,    1); // 0.40

  const bin1 = bins[1]; // [10, 20)
  assertEqual('Bin[1] chainage_start', bin1.chainage_start, 10);
  assertEqual('Bin[1] total_count',    bin1.total_count,    2);
  assertEqual('Bin[1] critical_count', bin1.critical_count, 1); // 0.90

  const binLast = bins[bins.length - 1]; // [240, 250)
  assertEqual('Last bin chainage_start', binLast.chainage_start, 240);
  assertEqual('Last bin total_count',    binLast.total_count,    1);
}

// ── Test 2: min_conf filter ────────────────────────────────────────────────────
console.log('\n[2] min_conf=0.50 filter');
{
  const bins = simulateBinning(MOCK_ROWS, 10, 0.50);
  // Only rows with confidence >= 0.50 survive (coord_z also cannot be null):
  //   2.0(0.80), 5.5(0.60), 12.0(0.90), 55.0(0.78), 249.9(0.55) → 5 rows, 5 bins
  const totalDetections = bins.reduce((s, b) => s + b.total_count, 0);
  assertEqual('Total detections after min_conf=0.50 filter', totalDetections, 5);
}

// ── Test 3: Interval=25 m ──────────────────────────────────────────────────────
console.log('\n[3] Interval=25 m, min_conf=0.0');
{
  const bins = simulateBinning(MOCK_ROWS, 25, 0.0);
  // Bucket keys: floor(z/25)*25
  //  z=2.0  → bucket 0  → [0, 25)
  //  z=5.5  → bucket 0  → [0, 25)
  //  z=9.9  → bucket 0  → [0, 25)
  //  z=12.0 → bucket 0  → [0, 25)
  //  z=18.5 → bucket 0  → [0, 25)
  //  z=1.0  → bucket 0  → [0, 25)
  //  z=55.0 → bucket 2  → [50, 75)
  //  z=120  → bucket 4  → [100,125) … wait floor(120/25)=4 → [100, 125)
  //  z=249.9→ bucket 9  → [225,250)
  const bin0 = bins.find((b) => b.chainage_start === 0);
  assertEqual('Bin[0–25) total_count', bin0.total_count, 6);

  const bin50 = bins.find((b) => b.chainage_start === 50);
  assertEqual('Bin[50–75) total_count', bin50.total_count, 1);
}

// ── Test 4: Risk level classification ─────────────────────────────────────────
console.log('\n[4] Risk level thresholds');
{
  assertEqual('HIGH when critical_count > 0',          classifyRisk(1, 0, 0.4), 'HIGH');
  assertEqual('HIGH when avg_confidence >= 0.75',      classifyRisk(0, 0, 0.75), 'HIGH');
  assertEqual('MEDIUM when major_count > 0',           classifyRisk(0, 1, 0.4), 'MEDIUM');
  assertEqual('MEDIUM when avg_confidence in [0.5,0.75)', classifyRisk(0, 0, 0.60), 'MEDIUM');
  assertEqual('LOW otherwise',                         classifyRisk(0, 0, 0.3), 'LOW');
}

// ── Test 5: Empty result when no rows pass filter ──────────────────────────────
console.log('\n[5] Empty bins when no rows pass filter');
{
  const bins = simulateBinning(MOCK_ROWS, 10, 0.99);
  assertEqual('bins is empty array', bins.length, 0);
}

// ── Test 6: NULL coord_z rows are always excluded ─────────────────────────────
console.log('\n[6] NULL coord_z exclusion');
{
  const nullOnlyRows = [
    { coord_z: null, confidence: 0.95 },
    { coord_z: null, confidence: 0.80 },
  ];
  const bins = simulateBinning(nullOnlyRows, 10, 0.0);
  assertEqual('No bins for null-coord_z rows', bins.length, 0);
}

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log('\n' + '━'.repeat(55));
const total = passed + failed;
const colour = failed === 0 ? GREEN : RED;
console.log(`${colour}Results: ${passed}/${total} passed${RESET}`);

if (failed > 0) {
  console.log(`${RED}${failed} test(s) failed — see above for details.${RESET}\n`);
  process.exit(1);
} else {
  console.log(`${GREEN}All tests passed ✓${RESET}\n`);
  process.exit(0);
}
