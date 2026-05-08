import type { PageDefinition } from "../../../engine/index.ts";
import { settingsBrainstormPage } from "./brainstorm.ts";
import { settingsLlmPage } from "./llm.ts";
import { modelTierPages } from "./model-tier.ts";
import { settingsModelsIndexPage } from "./models-index.ts";
import { settingsOutputPage } from "./output.ts";
import { settingsRootPage } from "./root.ts";
import { settingsRuntimePage } from "./runtime.ts";
import { settingsSearchPage } from "./search.ts";

/**
 * Settings page barrel. Order matters: parents MUST register before
 * children so {@link PageRegistry.register} accepts each entry.
 */
export const settingsPages: PageDefinition[] = [
  settingsRootPage,
  settingsModelsIndexPage,
  ...modelTierPages,
  settingsSearchPage,
  settingsLlmPage,
  settingsRuntimePage,
  settingsBrainstormPage,
  settingsOutputPage,
];

export {
  settingsBrainstormPage,
  settingsLlmPage,
  settingsModelsIndexPage,
  settingsOutputPage,
  settingsRootPage,
  settingsRuntimePage,
  settingsSearchPage,
};
export { makeModelTierPage, modelTierPages } from "./model-tier.ts";
