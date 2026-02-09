import { initialize } from "./lib";

initialize();

document.querySelector("#connect")?.addEventListener("click", async () => {
  window.cardano?.hodei?.enable();
});

document.querySelector("#check")?.addEventListener("click", async () => {
  const res = await window.cardano?.hodei?.isEnabled();
  console.log("isEnabled?", res);
});
