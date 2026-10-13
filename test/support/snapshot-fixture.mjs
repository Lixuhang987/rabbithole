import { buildSnapshotHtml } from '../../src/core/snapshot-html.js';
import { createSnapshotProjection } from '../../src/core/snapshot-projection.js';
import { toPersistedHole } from '../../src/core/schema.js';
import { getUiAssets, getDompurifyScript, getMermaidScript, getPdfJsScript, getPdfWorkerScript } from '../../src/node/shared/dist-assets.js';
export async function snapshotFixture(hole, assets = {}) {
  const ui = await getUiAssets();
  return buildSnapshotHtml({ title: hole.title, stylesheetText: ui.stylesheetText, frozenClientSource: ui.frozenClientSource,
    dompurifySource: getDompurifyScript(), mermaidSource: getMermaidScript(), pdfJsSource: getPdfJsScript(), pdfWorkerSource: getPdfWorkerScript(),
    snapshotProjection: createSnapshotProjection(toPersistedHole({ hole_id: 'snapshot-fixture', created_at: new Date().toISOString(), ...hole }), hole.view_state || null, assets) });
}
