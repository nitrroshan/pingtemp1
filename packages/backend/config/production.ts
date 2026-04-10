/**
 * Production environment overrides.
 */

import type { DeepPartial } from "./index.js";
import type { AppConfig } from "./index.js";
import { PROD_DEFAULTS } from "./featureFlags.js";

const productionConfig: DeepPartial<AppConfig> = {
  nodeEnv: "production",
  collabMode: "external",
  featureFlags: { ...PROD_DEFAULTS },
};

export default productionConfig;
