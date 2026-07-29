// toolbars.js — what the left mouse button does.
//
// Up to now the controls were verbs bolted onto buttons: left click places,
// right click deletes, C toggles paint, G releases, middle click picks. That
// stops scaling the moment there are more verbs than fingers, and it hides half
// the game from anyone who has not read the key list.
//
// So the cursor holds *one thing at a time*, and that thing is shown on screen.
// It can be a tool, a part or a whole machine — the left button always means
// "use what I am holding". Tab walks the toolbars, the number keys pick inside
// one, and the scroll wheel does the same without leaving the mouse.

import { CATEGORY, partsOf } from '../shared/parts.js';
import { PREFAB_IDS, PREFABS } from '../shared/prefabs.js';

export const SLOT = { TOOL: 'tool', PART: 'part', PREFAB: 'prefab' };

/**
 * Tools are verbs. Each one says what it does to whatever is under the cursor;
 * the builder dispatches on `id` and nothing else knows they exist.
 */
export const TOOLS = {
  paint:   { id: 'paint',   name: 'Malowanie', hint: 'LPM maluje część' },
  clone:   { id: 'clone',   name: 'Klonowanie', hint: 'LPM kopiuje część do ręki' },
  remove:  { id: 'remove',  name: 'Usuwanie', hint: 'LPM usuwa część' },
  release: { id: 'release', name: 'Puść', hint: 'LPM puszcza konstrukcję albo wraca ją na plac' },
  wire:    { id: 'wire',    name: 'Kabel', hint: 'LPM: źródło, potem cel. PPM zrywa kable' },
};

const toolSlot = (id) => ({ kind: SLOT.TOOL, id, name: TOOLS[id].name });
const partSlot = (id) => ({ kind: SLOT.PART, id });
const prefabSlot = (id) => ({ kind: SLOT.PREFAB, id, name: PREFABS[id].name });

export const TOOLBARS = [
  {
    id: 'tools',
    name: 'NARZĘDZIA',
    slots: [toolSlot('remove'), toolSlot('paint'), toolSlot('clone'),
            toolSlot('release'), toolSlot('wire')],
  },
  { id: 'blocks',   name: 'BLOKI',      slots: partsOf(CATEGORY.STRUCTURE).map(partSlot) },
  { id: 'machines', name: 'MASZYNY',    slots: [...partsOf(CATEGORY.DRIVE), ...partsOf(CATEGORY.MOTION)].map(partSlot) },
  { id: 'logic',    name: 'LOGIKA',     slots: partsOf(CATEGORY.LOGIC).map(partSlot) },
  { id: 'prefabs',  name: 'GOTOWCE',    slots: PREFAB_IDS.map(prefabSlot) },
];

/** How many number keys the UI has to offer. */
export const SLOTS_MAX = Math.max(...TOOLBARS.map((t) => t.slots.length));
