export async function bootstrapRenderer(context) {
  context.ensureApi();
  context.setButtons();
  context.updateAutoUi();
  context.clearSessionDetail();
  context.registerTabNavigation();
  context.activateTab("capture");
  context.registerUiEventHandlers();
  context.registerRealtimeSubscriptions();
  context.registerBeforeUnloadHandler();
  await context.runInitialLoadSequence();
  context.startAutoMonitor();
  context.log("Coview M5 ready.");
}
