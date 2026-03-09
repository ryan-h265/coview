import type { CoviewApi } from "./ipcContracts";

export {};

declare global {
  interface Window {
    coview: CoviewApi;
  }
}
