const script = document.createElement("script");
script.src = chrome.runtime.getURL("injected.js");
script.async = false;
document.head.appendChild(script);
script.addEventListener("load", () => document.head.removeChild(script));
