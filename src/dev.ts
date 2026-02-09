import { initialize } from "./lib";

initialize({
  onError: ({ error }) => console.log("socket error:", error ?? "unknown"),
  onClose: ({ code, reason }) => console.log("socket closed:", code, reason),
});

document.querySelector("#connect")?.addEventListener("click", async () => {
  window.cardano?.hodei?.enable();
});

document.querySelector("#check")?.addEventListener("click", async () => {
  const res = await window.cardano?.hodei?.isEnabled();
  console.log("isEnabled?", res);
});

document.querySelector("#toggle")?.addEventListener("click", async () => {
  const existing = document.querySelector("dialog");
  if (existing) {
    existing.remove();
    return;
  }

  const el = document.createElement("dialog");
  el.innerText = "my dialog with long text inside it";
  el.open = true;
  document.body.appendChild(el);
});
