const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("specApi", {
  getAuthConfig: () => ipcRenderer.invoke("spec:auth:get-config"),
  getAuthSession: () => ipcRenderer.invoke("spec:auth:get-session"),
  login: (payload) => ipcRenderer.invoke("spec:auth:login", payload),
  logout: () => ipcRenderer.invoke("spec:auth:logout"),
  getCountries: () => ipcRenderer.invoke("spec:get-countries"),
  runTask: (payload) => ipcRenderer.invoke("spec:run-task", payload),
  listTransferProducts: (payload) =>
    ipcRenderer.invoke("spec:transfer:list-products", payload),
  getTransferProductSpecs: (payload) =>
    ipcRenderer.invoke("spec:transfer:get-product-specs", payload),
  submitTransfer: (payload) => ipcRenderer.invoke("spec:transfer:submit", payload),
  onProgressPlan: (handler) => {
    if (typeof handler !== "function") {
      return () => {};
    }

    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("spec:progress-plan", listener);
    return () => ipcRenderer.removeListener("spec:progress-plan", listener);
  },
  onProgress: (handler) => {
    if (typeof handler !== "function") {
      return () => {};
    }

    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("spec:progress", listener);
    return () => ipcRenderer.removeListener("spec:progress", listener);
  },
});
