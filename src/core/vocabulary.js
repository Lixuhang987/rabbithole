/** @param {string[]} values */
function vocabulary(values) {
  return Object.freeze(Object.fromEntries(values.map((value) => [value.toUpperCase(), value])));
}

export const DOC_EVENT = vocabulary([
  "branch_request", "node_create", "node_progress", "node_answered", "delete_node",
  "node_deleted", "node_update", "nodes_update", "node_origin", "node_extensions_patch",
  "block_state", "view_state", "hole_title",
]);

export const WIRE_EVENT = vocabulary([
  "node_progress", "node_answered", "node_deleted", "node_search_status", "node_error",
  "node_extensions_patch", "pdf_convert_progress",
]);

export const HOST_COMMAND = vocabulary([
  "branch_request", "node_create", "retry_branch", "node_update", "nodes_update", "block_state",
  "node_extensions_patch", "convert_pdf", "convert_cancel", "delete_node", "view_state", "done",
]);

export const WEB_HOST_COMMANDS = Object.freeze(Object.values(HOST_COMMAND));

/**
 * Handler tables are transport protocols, not best-effort option bags. Assert
 * their exact vocabulary at startup so one host cannot silently drift from its
 * declared adapter contract.
 * @template {Record<string, (payload: any) => any>} T
 * @param {string} name
 * @param {T} handlers
 * @param {readonly string[]} expected
 * @returns {T}
 */
export function assertHostCommandHandlers(name, handlers, expected) {
  const actual = Object.keys(handlers).sort();
  const declared = [...expected].sort();
  if (actual.length !== declared.length || actual.some((value, index) => value !== declared[index])) {
    throw new Error(`${name} command table drift: expected ${declared.join(", ")}; got ${actual.join(", ")}`);
  }
  return handlers;
}
