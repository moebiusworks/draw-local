type SavedDocument = Record<string, unknown> & {
  elements: readonly unknown[];
  appState: Record<string, unknown>;
  files: Record<string, unknown>;
};

export function mergeDocument(
  original: unknown,
  elements: readonly unknown[],
  appState: Record<string, unknown>,
  files: Record<string, unknown>,
): SavedDocument {
  const previous =
    original && typeof original === "object" && !Array.isArray(original)
      ? (original as Record<string, unknown>)
      : {};
  const previousAppState =
    previous.appState &&
    typeof previous.appState === "object" &&
    !Array.isArray(previous.appState)
      ? (previous.appState as Record<string, unknown>)
      : {};
  const previousElements = new Map<string, Record<string, unknown>>();
  if (Array.isArray(previous.elements)) {
    for (const element of previous.elements) {
      if (
        element &&
        typeof element === "object" &&
        typeof element.id === "string"
      ) {
        previousElements.set(element.id, element as Record<string, unknown>);
      }
    }
  }
  const mergedElements = elements.map((element) => {
    if (
      !element ||
      typeof element !== "object" ||
      typeof (element as { id?: unknown }).id !== "string"
    )
      return element;
    const current = element as Record<string, unknown>;
    return { ...previousElements.get(current.id as string), ...current };
  });
  return {
    ...previous,
    type: previous.type ?? "excalidraw",
    version: previous.version ?? 2,
    source: previous.source ?? "draw-local",
    elements: mergedElements,
    appState: { ...previousAppState, ...appState, collaborators: undefined },
    files,
  };
}
