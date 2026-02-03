import { initialize } from "./lib";

initialize();

document.querySelector("#connect")?.addEventListener("click", async () => {
  window.cardano?.hodei?.enable();
});
