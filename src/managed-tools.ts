import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getConfigPath, loadConfig } from "./config.js";
import {
  getMappedProviderIdForTool,
  getProviderCapabilityStatus,
  isProviderCapabilityExposable,
  supportsTool,
} from "./provider-resolution.js";
import { PROVIDERS_BY_ID } from "./providers/index.js";
import type { ProviderId, Tool, WebProviders } from "./types.js";

export const CAPABILITY_TOOL_NAMES: Record<Tool, string> = {
  search: "web_search",
  contents: "web_contents",
  answer: "web_answer",
  research: "web_research",
};

export const MANAGED_TOOL_NAMES = Object.values(CAPABILITY_TOOL_NAMES);

export type ManagedToolRegistration = Partial<Record<Tool, ProviderId[]>>;

export type ManagedToolRegistrar = (
  providerIdsByCapability: ManagedToolRegistration,
) => void;

type ToolAvailabilityAPI = Pick<
  ExtensionAPI,
  "getActiveTools" | "setActiveTools" | "sendMessage"
>;

export function getAvailableProviderIdsForCapability(
  config: WebProviders,
  cwd: string,
  capability: Tool,
): ProviderId[] {
  const providerId = getMappedProviderIdForTool(config, capability);
  if (!providerId) {
    return [];
  }

  const provider = PROVIDERS_BY_ID[providerId];
  if (!supportsTool(provider, capability)) {
    return [];
  }

  const status = getProviderCapabilityStatus(
    config,
    cwd,
    providerId,
    capability,
    {
      resolveSecrets: false,
    },
  );
  return isProviderCapabilityExposable(status) ? [providerId] : [];
}

export function getProviderStatusForTool(
  config: WebProviders,
  cwd: string,
  providerId: ProviderId,
  capability: Tool,
) {
  return getProviderCapabilityStatus(config, cwd, providerId, capability);
}

export function getAvailableManagedToolNames(
  config: WebProviders,
  cwd: string,
): string[] {
  return (Object.keys(CAPABILITY_TOOL_NAMES) as Tool[])
    .filter(
      (capability) =>
        getAvailableProviderIdsForCapability(config, cwd, capability).length >
        0,
    )
    .map((capability) => CAPABILITY_TOOL_NAMES[capability]);
}

export function getSyncedActiveTools(
  config: WebProviders,
  cwd: string,
  activeToolNames: readonly string[],
  options: { addAvailable: boolean },
): Set<string> {
  const availableToolNames = new Set(getAvailableManagedToolNames(config, cwd));
  const nextActiveTools = new Set(activeToolNames);

  for (const toolName of MANAGED_TOOL_NAMES) {
    if (availableToolNames.has(toolName)) {
      if (options.addAvailable) {
        nextActiveTools.add(toolName);
      }
      continue;
    }

    nextActiveTools.delete(toolName);
  }

  return nextActiveTools;
}

export async function refreshManagedTools(
  pi: ToolAvailabilityAPI,
  registerManagedTools: ManagedToolRegistrar,
  cwd: string,
  options: { addAvailable: boolean },
): Promise<void> {
  const config = await loadConfig();
  const nextActiveTools = getSyncedActiveTools(
    config,
    cwd,
    pi.getActiveTools(),
    options,
  );

  registerManagedTools({
    search: getAvailableProviderIdsForCapability(config, cwd, "search"),
    contents: getAvailableProviderIdsForCapability(config, cwd, "contents"),
    answer: getAvailableProviderIdsForCapability(config, cwd, "answer"),
    research: getAvailableProviderIdsForCapability(config, cwd, "research"),
  });

  await syncManagedToolAvailability(pi, nextActiveTools);
}

export async function refreshManagedToolsOnStartup(
  pi: ToolAvailabilityAPI,
  registerManagedTools: ManagedToolRegistrar,
  cwd: string,
  options: { addAvailable: boolean },
): Promise<void> {
  try {
    await refreshManagedTools(pi, registerManagedTools, cwd, options);
  } catch (error) {
    pi.sendMessage({
      customType: "web-providers-config-error",
      content: formatStartupConfigError(error),
      display: true,
    });
    await syncManagedToolAvailability(
      pi,
      new Set(
        pi
          .getActiveTools()
          .filter((toolName) => !MANAGED_TOOL_NAMES.includes(toolName)),
      ),
    );
  }
}

function formatStartupConfigError(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `web-providers config error: ${detail.replace(getConfigPath(), "~/.pi/agent/web-providers.json")}`;
}

async function syncManagedToolAvailability(
  pi: Pick<ExtensionAPI, "getActiveTools" | "setActiveTools">,
  nextActiveTools: ReadonlySet<string>,
): Promise<void> {
  const activeTools = pi.getActiveTools();
  const changed =
    activeTools.length !== nextActiveTools.size ||
    activeTools.some((toolName) => !nextActiveTools.has(toolName));

  if (changed) {
    pi.setActiveTools(Array.from(nextActiveTools));
  }
}
