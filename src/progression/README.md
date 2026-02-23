# Progression Resolver (HBCR)

Pure, UI-agnostic progression resolver for **level 1–12 + multiclass**.

## Files
- `resolver.js` – deterministic resolver + subclass merge
- `loader.js` – small fetch helpers for `/data/class_progression/*.json`

## Quick usage

```js
import { loadClassProgressions, loadClassesFull } from "./progression/loader.js";
import { indexSubclasses, resolveProgression } from "./progression/resolver.js";

const classesFull = await loadClassesFull();
const subclassesIndex = indexSubclasses(classesFull);

const classProgressions = await loadClassProgressions([
  "wizard", "bard", "warlock" // etc
]);

const result = resolveProgression(
  {
    classes: [
      { classId: "wizard", level: 3, subclassId: "evocation" },
      { classId: "bard", level: 1, subclassId: "lore" }
    ],
    selections: {
      // choiceId -> chosen option(s)
      // e.g. "wizard.feat_gate.4": "alert"
    }
  },
  { classProgressions, subclassesIndex }
);

console.log(result.spellSlots);
console.log(result.pendingChoices);
```

## Spell slot rule implemented
HBCR rule: each spellcasting class grants slots **based on its own class level**, then slots are **added together**.
Warlock pact slots are tracked separately as `shortRest`.
