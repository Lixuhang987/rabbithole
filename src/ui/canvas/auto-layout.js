import { holeStore, nodes } from "../core.js";
import { organizeCanvas } from "./branch-arrangement.js";
import { measureBranches } from "./branch-geometry.js";

const SETTLE_MS = 400;

export function createAutoLayout({ clock, anchorId, canRun, beforeLayout = () => {} }) {
  let enabled = false;
  let disposed = false;
  let timer = null;
  let snapshots = new Map();
  const pendingRoots = new Set();

  function schedule() {
    if (timer) clock.clearTimeout(timer);
    timer = clock.setTimeout(flush, SETTLE_MS);
  }

  function changed() {
    if (!enabled || disposed) return;
    const next = new Map();
    const orders = new Map();
    for (const entry of measureBranches()) {
      const order = orders.get(entry.parent_id) || 0;
      orders.set(entry.parent_id, order + 1);
      const node = nodes[entry.id];
      // Measurement visits parents first, including the same eligible-card
      // boundary that the common organizer uses for its layout graph.
      const root = next.get(entry.parent_id)?.root || entry.id;
      const signature = [entry.parent_id, entry.width, entry.height, order, node.status, node.collapsed].join(":");
      next.set(entry.id, { signature, root });
      if (snapshots.get(entry.id)?.signature !== signature) pendingRoots.add(root);
    }
    for (const [id, previous] of snapshots) {
      if (!next.has(id)) pendingRoots.add(previous.root);
    }
    snapshots = next;
    if (pendingRoots.size) schedule();
  }

  function flush() {
    timer = null;
    if (!enabled || disposed || !pendingRoots.size) return;
    if (!canRun()) {
      timer = clock.setTimeout(flush, 150);
      return;
    }
    const roots = new Set(pendingRoots);
    pendingRoots.clear();
    beforeLayout();
    // Reflow only changed trees. Unrelated manually placed trees remain
    // obstacles, while an explicit Tidy recomputes the shared global columns.
    organizeCanvas({ roots, anchorId: anchorId() });
  }

  const unsubscribe = holeStore.subscribe((_state, invalidated) => {
    if (invalidated.has("nodes")) changed();
  });

  return {
    changed,
    setEnabled: function (next) {
      enabled = next;
      if (timer) clock.clearTimeout(timer);
      timer = null;
      pendingRoots.clear();
      snapshots = new Map();
      if (enabled) changed();
    },
    dispose: function () {
      disposed = true;
      if (timer) clock.clearTimeout(timer);
      timer = null;
      pendingRoots.clear();
      unsubscribe();
    },
  };
}
