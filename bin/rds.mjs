#!/usr/bin/env node
import { runCli } from '../dist/result.js'
// Let Node drain its Unicode-aware streams normally; never force an exit hook write.
process.exitCode = await runCli(process.argv.slice(2))
