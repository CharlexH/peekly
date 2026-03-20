export async function generateVisitorHash(
  ip: string,
  userAgent: string,
  dailySalt: string
): Promise<string> {
  const input = `${ip}|${userAgent}|${dailySalt}`;
  const data = new TextEncoder().encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = new Uint8Array(hashBuffer);
  let hex = "";
  for (let i = 0; i < hashArray.length; i++) {
    hex += hashArray[i].toString(16).padStart(2, "0");
  }
  return hex;
}

export async function getDailySalt(db: D1Database): Promise<string> {
  const today = new Date().toISOString().slice(0, 10);

  const existing = await db
    .prepare("SELECT salt FROM salts WHERE date = ?")
    .bind(today)
    .first<{ salt: string }>();

  if (existing) return existing.salt;

  const salt = crypto.randomUUID();
  await db
    .prepare("INSERT OR IGNORE INTO salts (date, salt) VALUES (?, ?)")
    .bind(today, salt)
    .run();

  // Re-read in case of race condition
  const result = await db
    .prepare("SELECT salt FROM salts WHERE date = ?")
    .bind(today)
    .first<{ salt: string }>();

  return result!.salt;
}
