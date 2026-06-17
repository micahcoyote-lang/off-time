/* materials.js — Job Site construction catalog: the tool belt and the building materials.
   Built in trade order (foundation → framing → sheathing → roofing → finishing); only the
   foundation is wired up so far, but the shape is ready for the rest.

   TOOLS — what's on the belt. Each:
     id      slug (used as the active-tool key)
     title   display name
     emoji   belt icon
     phase   the trade this tool works (matches a material's `phase`)
     remove  true for the demolition tool (takes pieces out instead of placing)

   MATERIALS — what you place. Each:
     id        slug
     title     display name
     emoji     chip icon
     tool      which TOOL places it
     phase     trade / build order
     anchor    how it snaps to a cell: 'floor' (fills the cell floor); later 'edge' | 'face' | 'top'
     size      { w, h, d } in world units (a cell is 1×1)
     color     hex for the mesh + ghost tint
     requires  build-order gate, checked by the rule engine (null = nothing needed first)
*/

export const TOOLS = [
  { id: 'trowel', title: 'Trowel', emoji: '🧱', phase: 'foundation' },
  { id: 'hammer', title: 'Hammer', emoji: '🔨', phase: 'framing' },
  { id: 'drill', title: 'Drill', emoji: '🪛', phase: 'sheathing' },
  { id: 'roofer', title: 'Roof', emoji: '🏠', phase: 'roofing' },
  { id: 'roller', title: 'Roller', emoji: '🎨', paint: true },
  { id: 'prybar', title: 'Pry Bar', emoji: '🪚', remove: true },
];

export const MATERIALS = [
  { id: 'concrete-slab', title: 'Concrete Slab', emoji: '🧱', tool: 'trowel', phase: 'foundation',
    anchor: 'floor', size: { w: 1, h: 0.25, d: 1 }, color: 0xb9b2a3, tex: 'concrete', requires: null },
  // edge pieces: framed wall variants standing on one edge of a cell. size = { t: thickness, h: height }
  { id: 'stud-wall', title: 'Stud Wall', emoji: '🪵', tool: 'hammer', phase: 'framing',
    anchor: 'edge', size: { t: 0.16, h: 2.5 }, color: 0xceaa72, tex: 'wood', requires: 'foundation' },
  { id: 'window-wall', title: 'Window', emoji: '🪟', tool: 'hammer', phase: 'framing',
    anchor: 'edge', size: { t: 0.16, h: 2.5 }, color: 0xceaa72, tex: 'wood', requires: 'foundation' },
  { id: 'door-wall', title: 'Door', emoji: '🚪', tool: 'hammer', phase: 'framing',
    anchor: 'edge', size: { t: 0.16, h: 2.5 }, color: 0xceaa72, tex: 'wood', requires: 'foundation' },
  // face pieces: flat sheets that close one side of a framed wall. size = { t: thickness, h: height }
  { id: 'plywood', title: 'Plywood', emoji: '🟫', tool: 'drill', phase: 'sheathing',
    anchor: 'face', size: { t: 0.05, h: 2.5 }, color: 0xcaa468, tex: 'wood', requires: 'framing' },
  { id: 'drywall', title: 'Drywall', emoji: '⬜', tool: 'drill', phase: 'sheathing',
    anchor: 'face', size: { t: 0.05, h: 2.5 }, color: 0xece8df, tex: null, requires: 'framing' },
  // roof piece: a sloped section (rafters + panel) over one cell, forming a gable across the footprint
  { id: 'roof-panel', title: 'Roof', emoji: '🏠', tool: 'roofer', phase: 'roofing',
    anchor: 'roof', size: {}, color: 0x4b5563, tex: null, requires: 'framing' },
];

export function getTool(id) {
  return TOOLS.find((t) => t.id === id) || null;
}

export function getMaterial(id) {
  return MATERIALS.find((m) => m.id === id) || null;
}

export function materialsForTool(toolId) {
  return MATERIALS.filter((m) => m.tool === toolId);
}
