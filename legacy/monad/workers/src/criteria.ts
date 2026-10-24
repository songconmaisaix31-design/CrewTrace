import { readFileSync } from "node:fs";
import { contentHash } from "./content.ts";

export const CRITERIA_BYTES = readFileSync(new URL("../criteria.json", import.meta.url));
export const CRITERIA_HASH = contentHash(CRITERIA_BYTES);
