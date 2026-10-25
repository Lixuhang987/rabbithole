import { snapshotProjectionToFrozenHydration } from "../../../core/snapshot-projection.js";
import checkCss from "../../../design/document/check.css";
import mermaidCss from "../../../design/document/mermaid.css";
import visualBaseCss from "../../../design/document/visual-base.css";
import { createRabbitholeUi } from "../../composition.js";
import { setVisualStyles } from "../../visual-style-runtime.js";

function startRabbithole(hydration) {
  setVisualStyles({ visualBaseCss, checkCss, mermaidCss });
  return createRabbitholeUi({
    hydration: hydration,
    capabilities: { exportSnapshot: null, exportPortable: null },
  });
}

export function startPortableSnapshot(projection) {
  return startRabbithole(snapshotProjectionToFrozenHydration(projection));
}
