export function selectLiveTests(
  providers,
  providerId,
  capability,
  includeResearch,
) {
  const all = providerId === "all";
  const selected = all
    ? providers
    : providers.filter((provider) => provider.id === providerId);
  if (!selected.length) throw new Error(`Unknown provider: ${providerId}`);
  const tests = [];
  const skipped = [];
  for (const provider of selected) {
    const capabilities =
      capability === "all" ? provider.capabilities : [capability];
    for (const name of capabilities) {
      const label = `${provider.id}/${name}`;
      if (name === "research" && !includeResearch) {
        skipped.push(`${label}: research requires explicit consent`);
      } else if (all && !provider.capabilities.includes(name)) {
        skipped.push(`${label}: unsupported capability`);
      } else if (all && !provider.configured.includes(name)) {
        skipped.push(`${label}: not configured`);
      } else {
        tests.push({ provider, capability: name });
      }
    }
  }
  return { tests, skipped };
}
