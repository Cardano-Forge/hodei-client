import { getFailureReason } from "../src/utils";

try {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("injected.js");
  script.async = false;
  document.head.appendChild(script);
  script.addEventListener("load", () => document.head.removeChild(script));
} catch (error) {
  console.log(
    "failed to inject hodei extension script:",
    getFailureReason(error),
  );
}
