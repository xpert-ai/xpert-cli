#!/usr/bin/env node

import { runCli } from "./cli.js";
import { formatCliError } from "./sdk/request-errors.js";

runCli(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`${formatCliError(error)}\n`);
  process.exitCode = 1;
});
