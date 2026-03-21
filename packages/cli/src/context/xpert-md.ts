import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";

const XPERT_MD_CANDIDATES = ["XPERT.md", "xpert.md"];

export async function loadXpertMd(projectRoot: string): Promise<{
  path?: string;
  content?: string;
}> {
  for (const candidate of XPERT_MD_CANDIDATES) {
    const absolutePath = path.join(projectRoot, candidate);
    try {
      await access(absolutePath, constants.R_OK);
      return {
        path: absolutePath,
        content: await readFile(absolutePath, "utf8"),
      };
    } catch {
      continue;
    }
  }

  return {};
}
