import { join } from "node:path";
import { app } from "electron";
import { CheckpointStore } from "./checkpoint-store";
export function checkpointStore() {
  return new CheckpointStore(join(app.getPath("userData"), "harness", "checkpoints"));
}
