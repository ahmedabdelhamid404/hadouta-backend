// Re-export the three few-shot story examples.
// Each file is independently readable for review (per Ahmed's session 9.5
// directive — examples in separate files so he can read them).

export { FRIENDSHIP_KINDNESS_3_5 } from "./01-friendship-3-5.js";
export { SCHOOL_COURAGE_5_7 } from "./02-school-5-7.js";
export { EID_GENEROSITY_6_8 } from "./03-eid-6-8.js";

import { FRIENDSHIP_KINDNESS_3_5 } from "./01-friendship-3-5.js";
import { SCHOOL_COURAGE_5_7 } from "./02-school-5-7.js";
import { EID_GENEROSITY_6_8 } from "./03-eid-6-8.js";

export const ALL_EXAMPLES = [
  FRIENDSHIP_KINDNESS_3_5,
  SCHOOL_COURAGE_5_7,
  EID_GENEROSITY_6_8,
] as const;
