#!/usr/bin/env node
'use strict';

/**
 * scripts/verify_all.js
 * HRT AI Inspection System — Unified Master Verification Runner
 *
 * Programmatically orchestrates and validates all 4 test tiers:
 *   - Tier 1: Baseline Feature Coverage
 *   - Tier 2: Boundary & Corner Cases
 *   - Tier 3: Cross-Component Integration
 *   - Tier 4: Real-World System Workload
 *
 * Usage:
 *   node scripts/verify_all.js            # Run all tiers (1-4)
 *   node scripts/verify_all.js --tier=1   # Run only Tier 1
 *   node scripts/verify_all.js --tier=2   # Run only Tier 2
 *   node scripts/verify_all.js --tier=3   # Run only Tier 3
 *   node scripts/verify_all.js --tier=4   # Run only Tier 4
 */

const path = require('path');

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';
const MAGENTA = '\x1b[35m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

const { runTier1 } = require('../tests/tier1_feature.test');
const { runTier2 } = require('../tests/tier2_boundary.test');
const { runTier3 } = require('../tests/tier3_integration.test');
const { runTier4 } = require('../tests/tier4_workload.test');

function parseArgs() {
  const args = process.argv.slice(2);
  let requestedTier = null;
  for (const arg of args) {
    if (arg.startsWith('--tier=')) {
      requestedTier = parseInt(arg.split('=')[1], 10);
    }
  }
  return { requestedTier };
}

async function main() {
  const { requestedTier } = parseArgs();
  const startTime = Date.now();

  console.log(`\n${BOLD}${MAGENTA}╔══════════════════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}${MAGENTA}║         HRT AI INSPECTION SYSTEM — UNIFIED VERIFICATION RUNNER       ║${RESET}`);
  console.log(`${BOLD}${MAGENTA}╚══════════════════════════════════════════════════════════════════════╝${RESET}`);
  console.log(`  ${BOLD}Timestamp:${RESET} ${new Date().toISOString()}`);
  console.log(`  ${BOLD}Platform:${RESET}  ${process.platform} (${process.arch})`);
  console.log(`  ${BOLD}Node.js:${RESET}   ${process.version}`);
  console.log(`  ${BOLD}Scope:${RESET}     ${requestedTier ? `Tier ${requestedTier} Only` : 'Complete End-to-End Suite (Tiers 1 - 4)'}`);

  const tierRunners = [
    { tier: 1, name: 'Tier 1: Baseline Feature Coverage', fn: runTier1 },
    { tier: 2, name: 'Tier 2: Boundary & Corner Cases', fn: runTier2 },
    { tier: 3, name: 'Tier 3: Cross-Component Integration', fn: runTier3 },
    { tier: 4, name: 'Tier 4: Real-World System Workload', fn: runTier4 },
  ];

  const executedResults = [];

  for (const runner of tierRunners) {
    if (requestedTier && runner.tier !== requestedTier) {
      continue;
    }

    try {
      const res = await runner.fn();
      executedResults.push({
        tier: runner.tier,
        name: runner.name,
        passed: res.passed,
        total: res.total,
        pass: res.pass,
      });
    } catch (err) {
      console.error(`\n${RED}Fatal error executing ${runner.name}:${RESET}`, err);
      executedResults.push({
        tier: runner.tier,
        name: runner.name,
        passed: 0,
        total: 1,
        pass: false,
      });
    }
  }

  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
  const totalPassed = executedResults.reduce((sum, r) => sum + r.passed, 0);
  const totalTests = executedResults.reduce((sum, r) => sum + r.total, 0);
  const allTiersPass = executedResults.every(r => r.pass);

  console.log(`\n${BOLD}${CYAN}══════════════════════════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}${CYAN}                      SYSTEM VERIFICATION SUMMARY                     ${RESET}`);
  console.log(`${BOLD}${CYAN}══════════════════════════════════════════════════════════════════════${RESET}`);
  console.log(`  ${BOLD}Tier   Category                               Results     Status${RESET}`);
  console.log(`  ${'─'.repeat(64)}`);

  for (const res of executedResults) {
    const statusBadge = res.pass ? `${GREEN}${BOLD}[PASS]${RESET}` : `${RED}${BOLD}[FAIL]${RESET}`;
    const score = `${res.passed}/${res.total}`.padEnd(10);
    const tierName = res.name.padEnd(40);
    console.log(`  T${res.tier}     ${tierName} ${score}  ${statusBadge}`);
  }

  console.log(`  ${'─'.repeat(64)}`);
  console.log(`  ${BOLD}Total:${RESET} ${totalPassed}/${totalTests} tests passed in ${totalDuration}s`);
  console.log(`  ${BOLD}Status:${RESET} ${allTiersPass ? `${GREEN}${BOLD}ALL TIERS PASSED ✓ (System Ready for Production & UAT)${RESET}` : `${RED}${BOLD}SYSTEM VERIFICATION FAILED${RESET}`}\n`);

  process.exit(allTiersPass ? 0 : 1);
}

main().catch(err => {
  console.error('Unhandled verification error:', err);
  process.exit(1);
});
