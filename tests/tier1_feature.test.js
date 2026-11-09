'use strict';

/**
 * tests/tier1_feature.test.js
 * Tier 1: Baseline Feature Coverage Test Suite
 *
 * Programmatically validates:
 *  - backend/src/api.test.js execution and exit code 0
 *  - backend/src/routes/spatial.test.js execution and exit code 0
 *  - Frontend static linting (npx --prefix frontend oxlint frontend/src)
 *  - Frontend production compilation (npm --prefix frontend run build)
 *  - AI Pipeline model inference with runs/detect/hrt_crack_det/weights/best.pt
 */

const { execSync, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT_DIR = path.resolve(__dirname, '..');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

async function runTier1() {
  console.log(`\n${BOLD}${CYAN}======================================================${RESET}`);
  console.log(`${BOLD}${CYAN}  TIER 1: Baseline Feature Coverage Verification      ${RESET}`);
  console.log(`${BOLD}${CYAN}======================================================${RESET}`);

  const results = [];

  function record(name, pass, details = '', durationMs = 0) {
    results.push({ name, pass, details, durationMs });
    const badge = pass ? `${GREEN}✓ PASS${RESET}` : `${RED}✗ FAIL${RESET}`;
    const timeStr = `${CYAN}(${durationMs}ms)${RESET}`;
    console.log(`  ${badge} ${name} ${timeStr}`);
    if (details && !pass) {
      console.log(`      ${RED}${details}${RESET}`);
    }
  }

  // 1. backend/src/api.test.js execution
  {
    const start = Date.now();
    try {
      const res = spawnSync(process.execPath, ['backend/src/api.test.js'], {
        cwd: ROOT_DIR,
        encoding: 'utf8',
        timeout: 30000,
      });
      const duration = Date.now() - start;
      const pass = res.status === 0 && res.stdout.includes('All API security & route contract checks passed');
      record(
        'Backend API contract & security suite (backend/src/api.test.js)',
        pass,
        res.stderr || res.stdout,
        duration
      );
    } catch (err) {
      record('Backend API contract & security suite (backend/src/api.test.js)', false, err.message, Date.now() - start);
    }
  }

  // 2. backend/src/routes/spatial.test.js execution
  {
    const start = Date.now();
    try {
      const res = spawnSync(process.execPath, ['backend/src/routes/spatial.test.js'], {
        cwd: ROOT_DIR,
        encoding: 'utf8',
        timeout: 30000,
      });
      const duration = Date.now() - start;
      const pass = res.status === 0 && res.stdout.includes('All tests passed');
      record(
        'Spatial analytics chainage binning suite (backend/src/routes/spatial.test.js)',
        pass,
        res.stderr || res.stdout,
        duration
      );
    } catch (err) {
      record('Spatial analytics chainage binning suite (backend/src/routes/spatial.test.js)', false, err.message, Date.now() - start);
    }
  }

  // 3. Frontend static linting (oxlint)
  {
    const start = Date.now();
    try {
      const output = execSync('npx --prefix frontend oxlint frontend/src', {
        cwd: ROOT_DIR,
        encoding: 'utf8',
        timeout: 30000,
      });
      const duration = Date.now() - start;
      const pass = output.includes('0 warnings and 0 errors');
      record(
        'Frontend static lint validation (oxlint frontend/src)',
        pass,
        output,
        duration
      );
    } catch (err) {
      record('Frontend static lint validation (oxlint frontend/src)', false, err.message, Date.now() - start);
    }
  }

  // 4. Frontend production build (vite build)
  {
    const start = Date.now();
    try {
      const output = execSync('npm --prefix frontend run build', {
        cwd: ROOT_DIR,
        encoding: 'utf8',
        timeout: 60000,
      });
      const duration = Date.now() - start;
      const distIndex = path.join(ROOT_DIR, 'frontend', 'dist', 'index.html');
      const pass = fs.existsSync(distIndex);
      record(
        'Frontend production build (npm --prefix frontend run build)',
        pass,
        output,
        duration
      );
    } catch (err) {
      record('Frontend production build (npm --prefix frontend run build)', false, err.message, Date.now() - start);
    }
  }

  // 5. AI Pipeline model inference with best.pt
  {
    const start = Date.now();
    const weightsPath = path.join(ROOT_DIR, 'runs', 'detect', 'hrt_crack_det', 'weights', 'best.pt');
    const sampleImg = path.join(ROOT_DIR, 'data', 'test', 'images', '011_agua_turbia_gris_jpg.rf.66b9929ace3626f958910de0c95df036.jpg');

    if (!fs.existsSync(weightsPath)) {
      record('AI Pipeline model inference with weights/best.pt', false, `Weights not found: ${weightsPath}`, 0);
    } else {
      try {
        const res = spawnSync('python', [
          'ai_pipeline/predict.py',
          '--weights', 'runs/detect/hrt_crack_det/weights/best.pt',
          '--source', sampleImg,
          '--conf', '0.25',
        ], {
          cwd: ROOT_DIR,
          encoding: 'utf8',
          timeout: 45000,
        });
        const duration = Date.now() - start;
        const telemetryCsv = path.join(ROOT_DIR, 'runs', 'predict', 'frame_telemetry.csv');
        const pass = res.status === 0 && fs.existsSync(telemetryCsv);
        record(
          'AI Pipeline YOLOv8 model inference & telemetry export (predict.py)',
          pass,
          res.stderr || res.stdout,
          duration
        );
      } catch (err) {
        record('AI Pipeline YOLOv8 model inference & telemetry export (predict.py)', false, err.message, Date.now() - start);
      }
    }
  }

  const passedCount = results.filter(r => r.pass).length;
  const totalCount = results.length;
  const allPass = passedCount === totalCount;

  console.log(`\nTier 1 Summary: ${allPass ? GREEN : RED}${passedCount}/${totalCount} passed${RESET}\n`);
  return { tier: 1, pass: allPass, total: totalCount, passed: passedCount, results };
}

if (require.main === module) {
  runTier1().then(res => {
    process.exit(res.pass ? 0 : 1);
  });
}

module.exports = { runTier1 };
