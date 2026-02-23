/**
 * Rules engine (stub)
 * Later: this is where HP, proficiencies, feature unlocking, spell limits, etc. get computed.
 */
export function recalculate(character) {
  // Keep it deterministic and pure: do not mutate input.
  return {
    ...character,
    derived: {
      hp: null,
      ac: null
    }
  };
}
