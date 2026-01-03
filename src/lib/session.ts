export function getSessionToken(keySuffix: string): string {
  if (typeof window === "undefined") {
    // Server-side render safe fallback
    return "";
  }

  const key = `hotshot_session_${keySuffix}`;
  let token = localStorage.getItem(key);

  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem(key, token);
  }

  return token;
}
