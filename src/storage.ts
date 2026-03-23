const STORAGE_KEY = "hodei-token";

export type ITokenStorage = {
  destroy(): void;
  getToken(): Promise<string | undefined>;
  setToken(token: string): void;
  deleteToken(): void;
};

export class DefaultTokenStorage implements ITokenStorage {
  private _bc = new BroadcastChannel(STORAGE_KEY);

  constructor() {
    this._bc.addEventListener("message", this._handleEvent);
  }

  private _handleEvent(event: MessageEvent) {
    console.log("event", event);
  }

  destroy() {
    this._bc.removeEventListener("message", this._handleEvent);
    this._bc.close();
  }

  async getToken(): Promise<string | undefined> {
    return localStorage.getItem(STORAGE_KEY) ?? undefined;
  }

  setToken(token: string): void {
    localStorage.setItem(STORAGE_KEY, token);
  }

  deleteToken() {
    localStorage.removeItem(STORAGE_KEY);
  }
}
