/**
 * Production environment overrides.
 */

import type { DeepPartial } from "./index.js";
import type { AppConfig } from "./index.js";

const productionConfig: DeepPartial<AppConfig> = {
  nodeEnv: "production",
};

export default productionConfig;
