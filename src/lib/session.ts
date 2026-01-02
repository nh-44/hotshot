export function getSessionToken(roomId: string): string {
  const key = `hotshot_session_${roomId}`;
  let token = localStorage.getItem(key);

  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem(key, token);
  }

  return token;
}
