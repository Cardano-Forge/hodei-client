const STORAGE_KEY = "hodei-token";

export function getToken(): string | undefined {
  return localStorage.getItem(STORAGE_KEY) ?? undefined;
}

export function setToken(token: string) {
  localStorage.setItem(STORAGE_KEY, token);
}

export function deleteToken() {
  localStorage.removeItem(STORAGE_KEY);
}
