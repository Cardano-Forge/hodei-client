# Hodei Client

## Installation

```bash
npm install @ada-anvil/hodei-client
```

## Usage

```ts
import { initialize } from "@ada-anvil/hodei-client";

// Initialize the client

const config = {
  debug: true,
  onError: ({ error }) => console.log("socket error:", error ?? "unknown"),
  onClose: ({ code, reason }) => console.log("socket closed:", code, reason),
};

initialize(config);

// CIP-30 API is now available in window.cardano.hodei

const wallet = await window.cardano.hodei.enable();

const utxos = await wallet.getUtxos();
```


## Weld integration

Hodei client seemlessly integrates with [Weld](https://github.com/Cardano-Forge/weld)'s plugin system.

### Installation

```bash
npm install @ada-anvil/weld-plugin-hodei @ada-anvil/weld
```

### Usage (Vanilla JS)

```ts
import { weld } from "@ada-anvil/weld";
import { builtinPlugins } from "@ada-anvil/weld/plugins";
import { hodeiPlugin } from "@ada-anvil/weld-plugin-hodei";

weld.config.update({
  plugins: [...builtinPlugins, hodeiPlugin(config)],
});

weld.init();
```

### Usage (React)

```tsx
import { weld } from "@ada-anvil/weld";
import { builtinPlugins } from "@ada-anvil/weld/plugins";
import { hodeiPlugin } from "@ada-anvil/weld-plugin-hodei";

export const App = ({ children }) => {
  return (
    <WeldProvider plugins={[...builtinPlugins, hodeiPlugin(config)]}>
      {children}
    </WeldProvider>
  );
};
```
